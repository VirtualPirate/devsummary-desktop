import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { chunk, KYSELY_DB } from '../../../../databases/kysely';
import type {
  AppDatabase,
  GithubCommitAnalysisInsert,
  GithubCommitAnalysisSelect,
} from '../../../../databases/kysely';

export type CommitAnalysisInsertInput = Omit<
  GithubCommitAnalysisInsert,
  'changes'
> & {
  changes?: string[] | null;
};

export interface CommitShaLocStats {
  sha: string;
  additions: number;
  deletions: number;
}

@Injectable()
export class CommitAnalysesRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async findByCommitId(
    commitId: string,
    tx?: AppDatabase,
  ): Promise<GithubCommitAnalysisSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('github.commitAnalyses')
      .selectAll()
      .where('commitId', '=', commitId)
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * The id list comes from a scan, so it is as long as the repository is busy —
   * one bind parameter each, against a 65535-per-statement cap. Split it.
   */
  async findCommitIdsWithAnalysis(
    commitIds: string[],
    tx?: AppDatabase,
  ): Promise<Set<string>> {
    if (commitIds.length === 0) return new Set();
    const db = this.exec(tx);
    const found = new Set<string>();
    for (const batch of chunk(commitIds)) {
      const rows = await db
        .selectFrom('github.commitAnalyses')
        .select('commitId')
        .where('commitId', 'in', batch)
        .execute();
      for (const r of rows) found.add(r.commitId);
    }
    return found;
  }

  async upsertSkippedMerge(commitId: string, tx?: AppDatabase): Promise<void> {
    await this.exec(tx)
      .insertInto('github.commitAnalyses')
      .values({
        commitId,
        status: 'skipped_merge',
        diffWasTruncated: false,
      })
      .onConflict((oc) =>
        oc.column('commitId').doUpdateSet({
          status: 'skipped_merge',
          updatedAt: new Date(),
        }),
      )
      .execute();
  }

  /**
   * Same cap as `findCommitIdsWithAnalysis`. Chunking drops cross-batch
   * atomicity, which costs nothing here: the caller re-analyses every id it
   * passed, so a crash between batches leaves rows that the retry deletes again.
   */
  async deleteForCommitIds(
    commitIds: string[],
    tx?: AppDatabase,
  ): Promise<void> {
    if (commitIds.length === 0) return;
    const db = this.exec(tx);
    for (const batch of chunk(commitIds)) {
      await db
        .deleteFrom('github.commitAnalyses')
        .where('commitId', 'in', batch)
        .execute();
    }
  }

  async insert(
    input: CommitAnalysisInsertInput,
    tx?: AppDatabase,
  ): Promise<GithubCommitAnalysisSelect> {
    const { changes, ...rest } = input;
    return this.exec(tx)
      .insertInto('github.commitAnalyses')
      .values({
        ...rest,
        changes: changes == null ? null : JSON.stringify(changes),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** One-time cheap pass: empty-diff commits trivially have zero line stats. */
  async zeroFillSkippedEmpty(tx?: AppDatabase): Promise<void> {
    await this.exec(tx)
      .updateTable('github.commitAnalyses')
      .set({ additions: 0, deletions: 0, updatedAt: new Date() })
      .where('status', '=', 'skipped_empty')
      .where('additions', 'is', null)
      .where('deletedAt', 'is', null)
      .execute();
  }

  /** Distinct repositories that still have analyses missing LOC stats
   * within the lookback window. skipped_merge is excluded by design —
   * merge stats double-count the merged work and stay NULL forever. */
  async findRepositoryIdsMissingLocStats(
    since: Date,
    tx?: AppDatabase,
  ): Promise<string[]> {
    const rows = await this.exec(tx)
      .selectFrom('github.commitAnalyses as a')
      .innerJoin('github.commits as c', 'c.id', 'a.commitId')
      .innerJoin('github.repositories as r', 'r.id', 'c.repositoryId')
      .select('c.repositoryId')
      .distinct()
      .where('a.additions', 'is', null)
      .where('a.status', '!=', 'skipped_merge')
      .where('a.deletedAt', 'is', null)
      .where('c.deletedAt', 'is', null)
      .where('r.deletedAt', 'is', null)
      .where('c.authoredAt', '>=', since)
      .execute();
    return rows.map((r) => r.repositoryId);
  }

  /** Bulk-writes LOC stats by commit SHA for one repository (one page of
   * GraphQL history). Only fills rows still NULL, never merge commits. */
  async setLocStatsBySha(
    repositoryId: string,
    stats: CommitShaLocStats[],
    tx?: AppDatabase,
  ): Promise<void> {
    if (stats.length === 0) return;
    const tuples = sql.join(
      stats.map(
        (s) => sql`(${s.sha}::text, ${s.additions}::int, ${s.deletions}::int)`,
      ),
      sql`, `,
    );
    await sql`
      update "github"."commit_analyses" a
      set "additions" = v.additions, "deletions" = v.deletions
      from (values ${tuples}) as v(sha, additions, deletions)
      join "github"."commits" c
        on c."sha" = v.sha and c."repository_id" = ${repositoryId}
      where a."commit_id" = c."id"
        and a."additions" is null
        and a."status" <> 'skipped_merge'
        and a."deleted_at" is null
        and c."deleted_at" is null
    `.execute(this.exec(tx));
  }

  /** After a repo's history is fully paged, record 0/0 for anything the
   * default-branch history did not return (force-pushed-away SHAs,
   * committed-vs-authored boundary cases) so the backfill converges. */
  async sealLocStats(
    repositoryId: string,
    since: Date,
    tx?: AppDatabase,
  ): Promise<void> {
    // The timestamp goes over the wire as ISO text with an explicit cast.
    await sql`
      update "github"."commit_analyses" a
      set "additions" = 0, "deletions" = 0
      from "github"."commits" c
      where a."commit_id" = c."id"
        and c."repository_id" = ${repositoryId}
        and c."authored_at" >= ${since.toISOString()}::timestamptz
        and c."deleted_at" is null
        and a."additions" is null
        and a."status" <> 'skipped_merge'
        and a."deleted_at" is null
    `.execute(this.exec(tx));
  }
}
