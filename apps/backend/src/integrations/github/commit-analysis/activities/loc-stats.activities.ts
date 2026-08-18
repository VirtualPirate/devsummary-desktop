import { Injectable, Logger } from '@nestjs/common';
import { MAX_HISTORY_DAYS } from '@launchstack/api-interfaces';
import { Activity } from '../../../../temporal';
import { GithubAppClient } from '../../github-app.client';
import { GithubInstallationsRepository } from '../../repositories/installations.repository';
import { GithubRepositoriesRepository } from '../../repositories/repositories.repository';
import { CommitAnalysesRepository } from '../repositories/commit-analyses.repository';

const LOOKBACK_DAYS = MAX_HISTORY_DAYS;
const PAGES_PER_RUN = 10; // 10 pages × 100 commits = up to 1000 commits/run

@Injectable()
export class LocStatsActivities {
  private readonly logger = new Logger(LocStatsActivities.name);

  constructor(
    private readonly analyses: CommitAnalysesRepository,
    private readonly repos: GithubRepositoriesRepository,
    private readonly installs: GithubInstallationsRepository,
    private readonly client: GithubAppClient,
  ) {}

  @Activity('loc.zeroFillAndFindMissing')
  async zeroFillAndFindMissing(): Promise<{ repositoryIds: string[] }> {
    // Cheap idempotent pass first: empty diffs are 0/0 by definition.
    await this.analyses.zeroFillSkippedEmpty();

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const repositoryIds =
      await this.analyses.findRepositoryIdsMissingLocStats(since);
    if (repositoryIds.length === 0) {
      this.logger.log('[loc-stats] nothing missing; backfill complete');
    } else {
      this.logger.log(
        `[loc-stats] found ${repositoryIds.length} repo(s) with missing LOC stats`,
      );
    }

    return { repositoryIds };
  }

  @Activity('loc.pageRepo')
  async pageRepo(input: {
    repositoryId: string;
    cursor: string | null;
  }): Promise<{ nextCursor: string | null }> {
    const repo = await this.repos.findById(input.repositoryId);
    if (!repo) {
      this.logger.warn(
        `[loc-stats] repo ${input.repositoryId} not found; exiting`,
      );
      return { nextCursor: null };
    }
    const installation = await this.installs.findById(repo.installationId);
    if (!installation) {
      this.logger.warn(
        `[loc-stats] installation ${repo.installationId} not found; exiting`,
      );
      return { nextCursor: null };
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const sinceISO = since.toISOString();

    let cursor = input.cursor;
    for (let page = 0; page < PAGES_PER_RUN; page++) {
      const result = await this.client.listCommitLocStats(
        installation.githubInstallationId,
        repo.fullName,
        sinceISO,
        cursor,
      );
      if (result.stats.length > 0) {
        await this.analyses.setLocStatsBySha(input.repositoryId, result.stats);
      }
      cursor = result.nextCursor;
      if (cursor === null) {
        // History exhausted. Anything still NULL in the window was not
        // returned by the default-branch history (force-pushed away,
        // committed-vs-authored boundary) — seal with 0/0 so the
        // backfill converges and later boots no-op.
        await this.analyses.sealLocStats(input.repositoryId, since);
        this.logger.log(`[loc-stats] ${repo.fullName} complete`);
        return { nextCursor: null };
      }
    }

    this.logger.log(`[loc-stats] ${repo.fullName} continuing`);
    return { nextCursor: cursor };
  }
}
