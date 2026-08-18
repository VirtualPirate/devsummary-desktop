import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { KYSELY_DB, type AppDatabase } from '../../../databases/kysely';

export interface TrackedRepositoryRow {
  repositoryId: string;
  fullName: string;
  branch: string;
  /** When the branch was chosen — the clock the `pending` grace window runs on. */
  trackedSince: Date;
}

export interface RepositoryCountsRow {
  repositoryId: string;
  commitCount: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
}

/**
 * Read model behind the onboarding console: how far each repository's first read
 * has got. Two queries rather than one so a repository with no commits yet still
 * appears (an inner join to `commits` would drop it, which is exactly the row the
 * user is waiting on).
 */
@Injectable()
export class IngestStatusRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  /** Repositories in the org that read a branch. Untracked ones are inert and omitted. */
  async listTracked(organizationId: string): Promise<TrackedRepositoryRow[]> {
    const rows = await this.db
      .selectFrom('github.repositoryBranches')
      .innerJoin(
        'github.repositories',
        'github.repositories.id',
        'github.repositoryBranches.repositoryId',
      )
      .innerJoin(
        'github.installations',
        'github.installations.id',
        'github.repositories.installationId',
      )
      .select([
        'github.repositoryBranches.repositoryId as repositoryId',
        'github.repositories.fullName as fullName',
        'github.repositoryBranches.branch as branch',
        'github.repositoryBranches.createdAt as trackedSince',
      ])
      .where('github.installations.organizationId', '=', organizationId)
      .where('github.repositoryBranches.deletedAt', 'is', null)
      .where('github.repositories.deletedAt', 'is', null)
      .where('github.installations.deletedAt', 'is', null)
      .orderBy('github.repositories.fullName', 'asc')
      .execute();

    return rows;
  }

  /**
   * Commit and analysis counts per repository, on the tracked branch only.
   *
   * Branch membership is an `EXISTS` against `commit_branches`, never a join —
   * the house rule everywhere commits are counted, because a commit seen on two
   * branches must not be counted twice. `commit_analyses` is safe to join: it
   * carries a unique index on `commit_id` (`commit_analyses_commit_unique`), so
   * it contributes at most one row per commit.
   *
   * Repositories with no commits yet are absent from the result — the caller
   * fills them in as zeros.
   */
  async countsFor(repositoryIds: string[]): Promise<RepositoryCountsRow[]> {
    if (repositoryIds.length === 0) return [];

    const rows = await this.db
      .selectFrom('github.repositoryBranches as rb')
      .innerJoin('github.commits as c', (join) =>
        join
          .onRef('c.repositoryId', '=', 'rb.repositoryId')
          .on('c.deletedAt', 'is', null),
      )
      .leftJoin('github.commitAnalyses as a', (join) =>
        join.onRef('a.commitId', '=', 'c.id').on('a.deletedAt', 'is', null),
      )
      .select((eb) => [
        'rb.repositoryId as repositoryId',
        eb.fn.countAll<number>().as('commitCount'),
        sql<number>`count(a.id)::int`.as('processedCount'),
        sql<number>`count(a.id) filter (where a.status in ('skipped_merge', 'skipped_empty'))::int`.as(
          'skippedCount',
        ),
        sql<number>`count(a.id) filter (where a.status = 'failed')::int`.as(
          'failedCount',
        ),
      ])
      .where('rb.deletedAt', 'is', null)
      .where('rb.repositoryId', 'in', repositoryIds)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('github.commitBranches as cb')
            .select('cb.id')
            .whereRef('cb.commitId', '=', 'c.id')
            .whereRef('cb.branch', '=', 'rb.branch'),
        ),
      )
      .groupBy('rb.repositoryId')
      .execute();

    // countAll comes back as int8 → BigInt under the pg type parser; the
    // filtered counts are cast in SQL. Normalize both.
    return rows.map((row) => ({
      repositoryId: row.repositoryId,
      commitCount: Number(row.commitCount),
      processedCount: Number(row.processedCount),
      skippedCount: Number(row.skippedCount),
      failedCount: Number(row.failedCount),
    }));
  }
}
