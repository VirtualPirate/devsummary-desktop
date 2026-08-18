import { Injectable } from '@nestjs/common';
import { AppError } from '../../../../common/errors';
import {
  CollaboratorsRepository,
  type UpsertCollaboratorInput,
} from '../../collaborators/repositories/collaborators.repository';
import { GithubAppClient, type GithubUserRef } from '../../github.client';
import { GithubInstallationsRepository } from '../../repositories/installations.repository';
import { GithubRepositoriesRepository } from '../../repositories/repositories.repository';
import { RepositoryBranchesRepository } from '../../repositories/repository-branches.repository';
import {
  CommitsRepository,
  type GithubCommitUpsertRow,
} from '../repositories/commits.repository';

export interface BackfillArgs {
  repositoryId: string;
  branch: string;
  sinceISO: string;
}

export interface BackfillFromLatestArgs {
  repositoryId: string;
  branch: string;
  lookbackDays: number;
}

interface RepoContext {
  installationGithubId: bigint;
  repoId: string;
  fullName: string;
  branch: string;
}

/**
 * Called after every page is written. Optional everywhere, because the only
 * caller with something to report to is the Temporal activity (it heartbeats);
 * the service is also driven from plain DI contexts with no activity around it.
 */
export type BackfillProgress = (progress: {
  inserted: number;
  pages: number;
}) => void;

@Injectable()
export class CommitBackfillService {
  constructor(
    private readonly repos: GithubRepositoriesRepository,
    private readonly installs: GithubInstallationsRepository,
    private readonly client: GithubAppClient,
    private readonly commits: CommitsRepository,
    private readonly trackedBranches: RepositoryBranchesRepository,
    private readonly collaborators: CollaboratorsRepository,
  ) {}

  async run(
    args: BackfillArgs,
    onProgress?: BackfillProgress,
  ): Promise<{ inserted: number }> {
    const ctx = await this.resolveContext(args.repositoryId, args.branch);
    const inserted = await this.pullAndUpsert(ctx, args.sinceISO, onProgress);
    return { inserted };
  }

  async runFromLatest(
    args: BackfillFromLatestArgs,
    onProgress?: BackfillProgress,
  ): Promise<{ inserted: number; sinceISO: string | null }> {
    const ctx = await this.resolveContext(args.repositoryId, args.branch);

    const latest = await this.client.getLatestCommitDate(
      ctx.installationGithubId,
      ctx.fullName,
      ctx.branch,
    );
    if (!latest) return { inserted: 0, sinceISO: null };

    const sinceISO = new Date(
      latest.getTime() - args.lookbackDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const inserted = await this.pullAndUpsert(ctx, sinceISO, onProgress);
    return { inserted, sinceISO };
  }

  /**
   * Decides what an incremental read is worth fetching, before any GitHub call.
   * Shared by both triggers: a `push` webhook passes the shas it was told about,
   * the nightly sweep passes none and relies on the window alone.
   *
   * Two gates, both aimed at not re-reading what is already stored:
   *
   * - the named shas are checked against what this branch already has, so a
   *   redelivered delivery, a force-push of known commits, or a fast-forward of
   *   commits already attributed here costs zero API calls;
   * - the window starts at the newest commit already on the branch rather than a
   *   lookback window, so a read fetches the tail and nothing else.
   *
   * `min(newest stored, earliest named)` because a force-push can rewind the
   * branch to an *older* base: taking the stored high-water mark alone would put
   * `since` past the new commits and fetch none of them.
   *
   * The sha gate is skipped when the caller names no shas (sweep) or when GitHub
   * truncated the payload, since "every sha we were told about is present" says
   * nothing about the ones we were not told about.
   *
   * A branch with **nothing stored** cannot resume from a high-water mark, so it is
   * *adopted* instead: `mode: 'adopt'` tells the caller to run the same
   * lookback-bounded first read the branch setup would have run. That covers a
   * repository whose scan failed, one tracked while the worker was down, and one
   * that has been sitting inert since before ingestion existed.
   *
   * Adoption is deliberately keyed on "no stored history", not on the trigger: a
   * push arriving at a never-read branch would otherwise store just the handful of
   * commits it named and, from then on, resume from that mark — leaving the older
   * history permanently invisible with no signal that anything is missing.
   *
   * The lookback bound is the caller's, not this method's: it is the one number a
   * workflow can carry in its history, and adoption otherwise means "everything
   * GitHub will give us".
   */
  async planIngest(args: {
    repositoryId: string;
    branch: string;
    shas: string[];
    truncated: boolean;
    earliestPushedISO: string | null;
  }): Promise<
    | { skip: 'untracked' | 'nothing-new' }
    | { skip: null; mode: 'resume'; sinceISO: string }
    | { skip: null; mode: 'adopt' }
  > {
    const tracked = await this.trackedBranches.listByRepository(
      args.repositoryId,
    );
    if (!tracked.includes(args.branch)) return { skip: 'untracked' };

    if (!args.truncated && args.shas.length > 0) {
      const present = await this.commits.findShasOnBranch({
        repositoryId: args.repositoryId,
        branch: args.branch,
        shas: args.shas,
      });
      if (args.shas.every((sha) => present.has(sha))) {
        return { skip: 'nothing-new' };
      }
    }

    const newest = await this.commits.findNewestCommittedAtOnBranch(
      args.repositoryId,
      args.branch,
    );
    if (!newest) return { skip: null, mode: 'adopt' };

    const earliestPushed = args.earliestPushedISO
      ? new Date(args.earliestPushedISO)
      : null;
    const since = earliestPushed
      ? new Date(Math.min(newest.getTime(), earliestPushed.getTime()))
      : newest;

    return { skip: null, mode: 'resume', sinceISO: since.toISOString() };
  }

  /**
   * The branch is an argument, never GitHub's default and never a guess: work is
   * only ever started for a branch the repository is *tracked* on, so an ingest
   * for an untracked branch means a stale workflow (a schedule started before
   * the branch was untracked) and must stop rather than resurrect it.
   */
  private async resolveContext(
    repositoryId: string,
    branch: string,
  ): Promise<RepoContext> {
    const repo = await this.repos.findById(repositoryId);
    if (!repo) throw AppError.GITHUB_REPOSITORY_NOT_FOUND();

    const installation = await this.installs.findById(repo.installationId);
    if (!installation) throw AppError.GITHUB_INSTALLATION_NOT_FOUND();

    const tracked = await this.trackedBranches.listByRepository(repo.id);
    if (!tracked.includes(branch)) {
      throw AppError.GITHUB_REPOSITORY_BRANCH_NOT_TRACKED({ branch });
    }

    return {
      installationGithubId: installation.githubInstallationId,
      repoId: repo.id,
      fullName: repo.fullName,
      branch,
    };
  }

  /**
   * Writes each page as it arrives, so peak memory is one page (100 commits)
   * rather than the whole lookback window. Both writes are idempotent and chunk
   * internally, which is what makes it safe to commit history in pieces: a run
   * that dies halfway leaves valid rows behind and the next one re-upserts them.
   *
   * A retry still restarts from page 1 — resuming mid-history would need
   * GitHub's pagination cursor persisted somewhere, which is out of scope. The
   * heartbeat fed by `onProgress` is what stops a long run from being killed and
   * restarted forever.
   */
  private async pullAndUpsert(
    ctx: RepoContext,
    sinceISO: string,
    onProgress?: BackfillProgress,
  ): Promise<number> {
    let inserted = 0;
    let pages = 0;

    await this.client.listCommits(
      ctx.installationGithubId,
      ctx.fullName,
      sinceISO,
      ctx.branch,
      async (page) => {
        const rows: GithubCommitUpsertRow[] = page.map((c) => ({
          repositoryId: ctx.repoId,
          sha: c.sha,
          parentCount: c.parentCount,
          message: c.message,
          authorGithubUserId: c.authorGithubUserId,
          authorGithubLogin: c.authorGithubLogin,
          authorName: c.authorName,
          authorEmail: c.authorEmail,
          committerGithubUserId: c.committerGithubUserId,
          committerGithubLogin: c.committerGithubLogin,
          committerName: c.committerName,
          committerEmail: c.committerEmail,
          authoredAt: c.authoredAt,
          committedAt: c.committedAt,
          raw: c.raw,
        }));

        // Upsert returns ids for commits that already existed too, so a commit
        // first seen on another branch still gets attributed to this one — that
        // shared ancestry is exactly what makes a second branch cheap (its
        // analyses are already cached per sha).
        const upserted = await this.commits.upsertMany(rows);
        await this.commits.linkToBranch(
          upserted.map((row) => row.id),
          ctx.branch,
        );

        // Ingest is where collaborators come from. The GitHub App's view of a
        // repository's access list is often near-empty (inherited permissions
        // are invisible to an installation), while every commit carries its
        // author's full user object — so the people a brief can be scoped to
        // are recorded here rather than by the collaborator sync.
        await this.collaborators.upsertManyFromCommitAuthors(
          page.flatMap((c) =>
            c.authorUser ? [toCollaboratorInput(c.authorUser)] : [],
          ),
        );

        inserted += rows.length;
        pages += 1;
        onProgress?.({ inserted, pages });
      },
    );

    return inserted;
  }
}

function toCollaboratorInput(user: GithubUserRef): UpsertCollaboratorInput {
  return {
    githubUserId: BigInt(user.id),
    login: user.login,
    nodeId: user.node_id ?? null,
    avatarUrl: user.avatar_url ?? null,
    htmlUrl: user.html_url ?? null,
    type: user.type ?? null,
    siteAdmin: user.site_admin ?? false,
    raw: user,
  };
}
