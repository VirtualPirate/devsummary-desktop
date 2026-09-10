import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../../../common/errors';
import { GithubAppClient, type GithubCommitDetail } from '../../github.client';
import { GithubInstallationsRepository } from '../../repositories/installations.repository';
import { GithubRepositoriesRepository } from '../../repositories/repositories.repository';
import { RepositoryBranchesRepository } from '../../repositories/repository-branches.repository';
import { CommitAnalysesRepository } from '../repositories/commit-analyses.repository';
import { CommitsRepository } from '../repositories/commits.repository';
import {
  CommitAnalyzerService,
  type AnalyzeCommitResult,
  type BatchAnalyzeInput,
} from '../services/commit-analyzer.service';
import { CommitBackfillService } from '../services/commit-backfill.service';

/** One commit, read and ready for the model. */
interface Prepared {
  commitId: string;
  additions: number;
  deletions: number;
  input: BatchAnalyzeInput;
}

@Injectable()
export class CommitAnalysisActivities {
  private readonly logger = new Logger(CommitAnalysisActivities.name);

  constructor(
    private readonly backfill: CommitBackfillService,
    private readonly commits: CommitsRepository,
    private readonly analyses: CommitAnalysesRepository,
    private readonly repos: GithubRepositoriesRepository,
    private readonly installs: GithubInstallationsRepository,
    private readonly client: GithubAppClient,
    private readonly analyzer: CommitAnalyzerService,
    private readonly trackedBranches: RepositoryBranchesRepository,
  ) {}

  /**
   * Progress for the two ingestion methods, which page a whole lookback window
   * in one call. This was a Temporal `Context.current().heartbeat(details)`,
   * whose job was to keep a long backfill from tripping `heartbeatTimeout`.
   * In process there is no scheduler to reassure, so the only thing left worth
   * keeping is the progress itself — a log line, not new machinery.
   */
  private heartbeat(details: unknown): void {
    this.logger.debug(`[commits.backfill] progress ${JSON.stringify(details)}`);
  }

  async backfillFromLatest(input: {
    repositoryId: string;
    branch: string;
    lookbackDays: number;
  }): Promise<{ inserted: number; sinceISO: string | null }> {
    const r = await this.backfill.runFromLatest(
      {
        repositoryId: input.repositoryId,
        branch: input.branch,
        lookbackDays: input.lookbackDays,
      },
      (progress) => this.heartbeat(progress),
    );
    return r;
  }

  async planIngest(input: {
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
    const plan = await this.backfill.planIngest(input);
    const outcome = plan.skip
      ? `skip=${plan.skip}`
      : plan.mode === 'adopt'
        ? 'mode=adopt (no stored history on this branch)'
        : `mode=resume since=${plan.sinceISO}`;
    this.logger.log(
      `[commits.planIngest] repo=${input.repositoryId} branch=${input.branch} shas=${input.shas.length} truncated=${input.truncated} ${outcome}`,
    );
    return plan;
  }

  /**
   * The sweep's work list, one page at a time.
   *
   * `runDate` is stamped here because the calling workflow cannot read a clock,
   * and it is what makes a sweep child's workflow id stable for the day (so a
   * re-run of the same night's sweep reuses the runs rather than starting a
   * second set).
   */
  async listSweepTargets(input: {
    limit: number;
    after?: { repositoryId: string; branch: string } | null;
  }): Promise<{
    runDate: string;
    targets: Array<{
      repositoryId: string;
      branch: string;
      organizationId: string;
    }>;
    nextCursor: { repositoryId: string; branch: string } | null;
  }> {
    const targets = await this.trackedBranches.listTrackedPage({
      limit: input.limit,
      after: input.after ?? null,
    });

    const last = targets[targets.length - 1];
    const nextCursor =
      targets.length < input.limit || !last
        ? null
        : { repositoryId: last.repositoryId, branch: last.branch };

    this.logger.log(
      `[commits.listSweepTargets] targets=${targets.length} more=${nextCursor !== null}`,
    );

    return {
      runDate: new Date().toISOString().slice(0, 10),
      targets,
      nextCursor,
    };
  }

  async backfillCommits(input: {
    repositoryId: string;
    branch: string;
    sinceISO: string;
  }): Promise<{ inserted: number }> {
    const r = await this.backfill.run(
      {
        repositoryId: input.repositoryId,
        branch: input.branch,
        sinceISO: input.sinceISO,
      },
      (progress) => this.heartbeat(progress),
    );
    return r;
  }

  /**
   * Plans **one page** of a repository's history, not all of it.
   *
   * The caller is a workflow, so everything returned here crosses a Temporal
   * payload boundary (2 MB hard, 256 KB warn) and is replayed from history. A
   * whole repository's commit ids would blow that on a busy repo, so the page
   * size is the caller's and the position travels back as `nextCursor` — a
   * two-field cursor instead of an unbounded array. See `docs/scale-ceilings.md`.
   *
   * The cursor advances over every commit in the page, including merges and
   * already-analysed ones, so the caller's loop terminates even if a commit
   * never ends up with an analysis row.
   */
  async planRepoAnalysis(input: {
    repositoryId: string;
    sinceISO: string;
    force: boolean;
    limit: number;
    after?: { authoredAt: string; id: string } | null;
  }): Promise<{
    commitIds: string[];
    nextCursor: { authoredAt: string; id: string } | null;
  }> {
    const page = await this.commits.findPageByRepositorySince({
      repositoryId: input.repositoryId,
      sinceISO: input.sinceISO,
      limit: input.limit,
      after: input.after
        ? { authoredAt: new Date(input.after.authoredAt), id: input.after.id }
        : undefined,
    });
    if (page.length === 0) return { commitIds: [], nextCursor: null };

    const mergeIds: string[] = [];
    const candidateIds: string[] = [];
    for (const c of page) {
      if (c.parentCount > 1) mergeIds.push(c.id);
      else candidateIds.push(c.id);
    }

    for (const mergeId of mergeIds) {
      await this.analyses.upsertSkippedMerge(mergeId);
    }

    let toEnqueue = candidateIds;
    if (input.force) {
      // Page-scoped, and the cursor never revisits a page — so re-analysed
      // commits are not deleted again by a later run.
      await this.analyses.deleteForCommitIds(candidateIds);
    } else {
      const already =
        await this.analyses.findCommitIdsWithAnalysis(candidateIds);
      toEnqueue = candidateIds.filter((cid) => !already.has(cid));
    }

    const last = page[page.length - 1];
    const nextCursor =
      page.length < input.limit
        ? null
        : { authoredAt: last.authoredAt.toISOString(), id: last.id };

    this.logger.log(
      `[analysis.planRepoAnalysis] repo=${input.repositoryId} page=${page.length} merges=${mergeIds.length} candidates=${candidateIds.length} enqueued=${toEnqueue.length} more=${nextCursor !== null}`,
    );

    return { commitIds: toEnqueue, nextCursor };
  }

  /**
   * How many commits one LLM call carries, decided by the provider that is
   * selected *now*. Surfaced here because the fan-out in `analyzeRepo` is what
   * chunks by it, and the jobs class holds activities rather than config.
   */
  get commitsPerCall(): number {
    return this.analyzer.commitsPerCall;
  }

  /**
   * Everything one analysis needs, or `null` when there is nothing to do.
   *
   * Extracted so the batch path and the single path cannot disagree about what
   * counts as "already analysed" or "gone". A GitHub failure still throws
   * after recording, exactly as it did when this was inline: it is the one
   * outcome worth retrying, and the caller decides whether a sibling commit
   * survives it.
   */
  private async prepare(commitId: string): Promise<Prepared | null> {
    const commit = await this.commits.findById(commitId);
    if (!commit) {
      this.logger.warn(
        `[analyze-commit] commit ${commitId} not found; exiting`,
      );
      return null;
    }

    const existing = await this.analyses.findByCommitId(commit.id);
    if (existing && existing.status !== 'failed') {
      this.logger.log(
        `[analyze-commit] commit ${commit.id} already has ${existing.status}; exiting`,
      );
      return null;
    }

    const repo = await this.repos.findById(commit.repositoryId);
    if (!repo) {
      this.logger.warn(
        `[analyze-commit] repo ${commit.repositoryId} not found; exiting`,
      );
      return null;
    }
    const installation = await this.installs.findById(repo.installationId);
    if (!installation) {
      this.logger.warn(
        `[analyze-commit] installation ${repo.installationId} not found; exiting`,
      );
      return null;
    }

    let detail: GithubCommitDetail;
    try {
      detail = await this.client.getCommit(
        installation.githubInstallationId,
        repo.fullName,
        commit.sha,
      );
    } catch (err) {
      await this.recordFailed(commit.id, err);
      throw err;
    }

    return {
      commitId: commit.id,
      additions: detail.files.reduce((sum, f) => sum + f.additions, 0),
      deletions: detail.files.reduce((sum, f) => sum + f.deletions, 0),
      input: {
        sha: commit.sha,
        repoFullName: repo.fullName,
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
        message: commit.message,
        files: detail.files,
      },
    };
  }

  private async persist(
    ready: Prepared,
    result: AnalyzeCommitResult,
  ): Promise<void> {
    if (result.status === 'skipped_empty') {
      await this.analyses.insert({
        commitId: ready.commitId,
        status: 'skipped_empty',
        diffWasTruncated: false,
        additions: ready.additions,
        deletions: ready.deletions,
      });
      return;
    }

    await this.analyses.insert({
      commitId: ready.commitId,
      status: 'analyzed',
      commitType: result.commitType,
      summary: result.summary,
      changes: result.changes,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      diffCharsSent: result.diffCharsSent,
      diffWasTruncated: result.diffWasTruncated,
      additions: ready.additions,
      deletions: ready.deletions,
    });
  }

  async analyzeCommit(input: { commitId: string }): Promise<void> {
    const ready = await this.prepare(input.commitId);
    if (!ready) return;

    try {
      await this.persist(ready, await this.analyzer.analyzeCommit(ready.input));
    } catch (err) {
      await this.recordFailed(ready.commitId, err);
      throw err;
    }
  }

  /**
   * One LLM call for several commits, which on an agent CLI is one process
   * instead of four (`COMMITS_PER_CALL`).
   *
   * Every path back to a single call is deliberate. A commit the batch left
   * out, or answered under a sha nobody asked for, is analysed alone — the
   * alternative is writing one commit's summary onto another's row. A
   * malformed *batch* answer is about the batch, so its commits are retried
   * singly straight away. A **transport** failure is about the provider, and
   * four more calls into a throttled CLI would time out the same way for
   * 120 s each, so those are recorded and left to the job's retry profile.
   */
  async analyzeCommitBatch(input: { commitIds: string[] }): Promise<void> {
    if (input.commitIds.length === 1) {
      return this.analyzeCommit({ commitId: input.commitIds[0] });
    }

    const ready: Prepared[] = [];
    for (const commitId of input.commitIds) {
      try {
        const prepared = await this.prepare(commitId);
        if (prepared) ready.push(prepared);
      } catch (err) {
        // Recorded against that commit already; its siblings are unaffected
        // and the job row carries the retry.
        this.logger.warn(
          `[analyze-batch] commit ${commitId} could not be prepared: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }
    if (ready.length === 0) return;

    let answered: Map<string, AnalyzeCommitResult>;
    try {
      answered = await this.analyzer.analyzeCommits(ready.map((r) => r.input));
    } catch (err) {
      if (
        err instanceof ApiException &&
        err.code === 'OPENAI_RESPONSE_INVALID'
      ) {
        await this.analyzeEachAlone(ready);
        return;
      }
      for (const r of ready) await this.recordFailed(r.commitId, err);
      throw err;
    }

    const unanswered: Prepared[] = [];
    for (const r of ready) {
      const result = answered.get(r.input.sha);
      if (!result) {
        unanswered.push(r);
        continue;
      }
      await this.persist(r, result);
    }

    if (unanswered.length > 0) {
      this.logger.warn(
        `[analyze-batch] ${unanswered.length}/${ready.length} commits unanswered; retrying alone`,
      );
      await this.analyzeEachAlone(unanswered);
    }
  }

  /**
   * The fallback. `analyzeCommit` re-runs `prepare`, so each of these costs a
   * second GitHub read — cheap next to a second LLM call, and it keeps one
   * definition of what a single analysis is.
   */
  private async analyzeEachAlone(ready: Prepared[]): Promise<void> {
    for (const r of ready) {
      try {
        await this.analyzeCommit({ commitId: r.commitId });
      } catch {
        // Recorded by `analyzeCommit`; a sibling must still get its turn.
      }
    }
  }

  private async recordFailed(commitId: string, err: unknown): Promise<void> {
    const reason = err instanceof Error ? err.message : 'Unknown error';
    try {
      await this.analyses.insert({
        commitId,
        status: 'failed',
        failureReason: reason,
        diffWasTruncated: false,
      });
    } catch {
      // If a row already exists (race with another retry), ignore — the
      // unique index keeps us idempotent.
    }
  }
}
