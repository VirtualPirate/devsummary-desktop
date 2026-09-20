import { Inject, Injectable } from '@nestjs/common';
import { sql, type SelectQueryBuilder } from 'kysely';
import {
  chunk,
  commitClockColumn,
  KYSELY_DB,
} from '../../../../databases/kysely';
import type {
  AppDatabase,
  BriefCommitClock,
  Database,
  GithubCollaboratorSelect,
  GithubCommitAnalysisSelect,
  GithubCommitAnalysisStatus,
  GithubCommitInsert,
  GithubCommitSelect,
} from '../../../../databases/kysely';

export type GithubCommitUpsertRow = Omit<GithubCommitInsert, 'raw'> & {
  raw: unknown;
};

interface BriefScopeQuery {
  repositoryIds: string[];
  /** Inclusive. */
  periodStart: Date;
  /** Exclusive — a brief period is half-open (see `PeriodWindow`). */
  periodEnd: Date;
  /**
   * Which commit timestamp the period bounds — the clock snapshotted on the
   * brief being generated (`brief.commitClock`), so a historical brief keeps
   * selecting the set it was written from. Never interpolated: it goes through
   * `commitClockColumn`, a closed switch that throws on anything else.
   */
  commitClock: BriefCommitClock;
  collaboratorGithubUserIds?: bigint[];
  branch?: string;
  tx?: AppDatabase;
}

interface BriefScopeCommit {
  commit: GithubCommitSelect;
  analysis: GithubCommitAnalysisSelect | null;
}

/**
 * Rows per round trip when `findForBriefScope` walks a whole period. Not a cap
 * on anything — the old `5000` was a truncation point, this is only how much of
 * the period is fetched at a time.
 */
export const BRIEF_SCOPE_PAGE_ROWS = 2000;

@Injectable()
export class CommitsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  /**
   * An author filter of `[]` means the caller's scope selected nobody (e.g. a
   * brief scoped to a team with no members) — distinct from `undefined`, which
   * means "no author restriction". Applying the SQL predicate only when the list
   * is non-empty would turn the former into the latter and widen the scope to
   * every author in the given repositories.
   */
  private selectsNoAuthors(collaboratorGithubUserIds?: bigint[]): boolean {
    return (
      collaboratorGithubUserIds !== undefined &&
      collaboratorGithubUserIds.length === 0
    );
  }

  /**
   * Restrict to commits seen on `branch`. EXISTS, not a join: a commit sits on
   * every branch that can reach it, and a join would return it once per branch.
   */
  private applyBranchFilter<O>(
    query: SelectQueryBuilder<Database, 'github.commits', O>,
    branch?: string,
  ): SelectQueryBuilder<Database, 'github.commits', O> {
    if (branch === undefined) return query;
    return query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('github.commitBranches as cb')
          .select('cb.id')
          .whereRef('cb.commitId', '=', 'github.commits.id')
          .where('cb.branch', '=', branch),
      ),
    );
  }

  /**
   * Returns the row id for every input commit, inserted or already present —
   * `DO UPDATE` (rather than `DO NOTHING`) is what makes RETURNING cover the
   * conflicting rows too, which is how the caller can attribute an already-known
   * commit to an additional branch.
   *
   * The update list is deliberately short, and `landedAt` is deliberately not on
   * it: an incremental read widens its window back past commits already stored
   * (see `planIngest`), so the same commit is re-offered on every subsequent
   * read. First write wins, which is what makes `landedAt` mean "first seen"
   * rather than "last re-fetched".
   */
  async upsertMany(
    rows: GithubCommitUpsertRow[],
    tx?: AppDatabase,
  ): Promise<Array<{ id: string; sha: string }>> {
    if (rows.length === 0) return [];
    const db = this.exec(tx);
    const out: Array<{ id: string; sha: string }> = [];
    for (const batch of chunk(rows)) {
      const inserted = await db
        .insertInto('github.commits')
        .values(batch.map((row) => ({ ...row, raw: JSON.stringify(row.raw) })))
        .onConflict((oc) =>
          oc.columns(['repositoryId', 'sha']).doUpdateSet({
            raw: (eb) => eb.ref('excluded.raw'),
            message: (eb) => eb.ref('excluded.message'),
            updatedAt: new Date(),
          }),
        )
        .returning(['id', 'sha'])
        .execute();
      out.push(...inserted);
    }
    return out;
  }

  /**
   * Record that these commits were seen on `branch`. Branches share ancestry, so
   * the same commit legitimately gets a row per branch and a re-fetch of the
   * same branch must be a no-op — hence the conflict clause.
   */
  async linkToBranch(
    commitIds: string[],
    branch: string,
    tx?: AppDatabase,
  ): Promise<void> {
    if (commitIds.length === 0) return;
    const db = this.exec(tx);
    for (const batch of chunk(commitIds)) {
      await db
        .insertInto('github.commitBranches')
        .values(batch.map((commitId) => ({ commitId, branch })))
        .onConflict((oc) => oc.columns(['commitId', 'branch']).doNothing())
        .execute();
    }
  }

  /**
   * Which of `shas` this repository already has **attributed to `branch`**.
   *
   * Joined to `commit_branches` rather than read off `github.commits` alone: a
   * commit ingested from a different branch exists as a row but carries no link
   * to this one, and every brief query narrows by branch via `commit_branches` —
   * so treating it as "already stored" would drop it from this branch's briefs
   * forever. "Stored" here has to mean "already on this branch".
   */
  async findShasOnBranch(input: {
    repositoryId: string;
    branch: string;
    shas: string[];
    tx?: AppDatabase;
  }): Promise<Set<string>> {
    const out = new Set<string>();
    if (input.shas.length === 0) return out;
    const db = this.exec(input.tx);
    for (const batch of chunk(input.shas)) {
      const rows = await db
        .selectFrom('github.commits as c')
        .innerJoin('github.commitBranches as cb', 'cb.commitId', 'c.id')
        .select('c.sha')
        .where('c.repositoryId', '=', input.repositoryId)
        .where('c.sha', 'in', batch)
        .where('c.deletedAt', 'is', null)
        .where('cb.branch', '=', input.branch)
        .execute();
      for (const row of rows) out.add(row.sha);
    }
    return out;
  }

  /**
   * Newest commit date among the commits attributed to `branch` — the resume
   * point for an incremental read, so a push fetches the tail rather than a
   * fixed lookback window.
   *
   * `committedAt`, not `authoredAt`: GitHub's `since` filters by commit date,
   * and a rebase or cherry-pick leaves `authoredAt` arbitrarily far in the past,
   * which would re-walk history that is already stored.
   */
  async findNewestCommittedAtOnBranch(
    repositoryId: string,
    branch: string,
    tx?: AppDatabase,
  ): Promise<Date | null> {
    const row = await this.exec(tx)
      .selectFrom('github.commits as c')
      .innerJoin('github.commitBranches as cb', 'cb.commitId', 'c.id')
      .select('c.committedAt')
      .where('c.repositoryId', '=', repositoryId)
      .where('c.deletedAt', 'is', null)
      .where('cb.branch', '=', branch)
      .orderBy('c.committedAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.committedAt ?? null;
  }

  async findById(
    id: string,
    tx?: AppDatabase,
  ): Promise<GithubCommitSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('github.commits')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * One page of a repository's history, oldest first, for the analysis planner.
   *
   * Keyset on `(authoredAt, id)` rather than OFFSET, and ordered by the same
   * pair the `commits_repo_authored_at_idx` index already provides. `id` breaks
   * ties: commits sharing an `authoredAt` are common (a pushed batch), and
   * ordering by the timestamp alone would skip or repeat them across the page
   * boundary. The cursor advances over every row it returns, analysed or not,
   * so a caller looping on it always terminates.
   */
  async findPageByRepositorySince(input: {
    repositoryId: string;
    sinceISO: string;
    limit: number;
    after?: { authoredAt: Date; id: string };
    tx?: AppDatabase;
  }): Promise<
    Array<Pick<GithubCommitSelect, 'id' | 'parentCount' | 'authoredAt'>>
  > {
    let query = this.exec(input.tx)
      .selectFrom('github.commits')
      .select(['id', 'parentCount', 'authoredAt'])
      .where('repositoryId', '=', input.repositoryId)
      .where('authoredAt', '>=', new Date(input.sinceISO))
      .where('deletedAt', 'is', null);
    const after = input.after;
    if (after) {
      query = query.where((eb) =>
        eb.or([
          eb('authoredAt', '>', after.authoredAt),
          eb.and([
            eb('authoredAt', '=', after.authoredAt),
            eb('id', '>', after.id),
          ]),
        ]),
      );
    }
    return query
      .orderBy('authoredAt', 'asc')
      .orderBy('id', 'asc')
      .limit(input.limit)
      .execute();
  }

  async countByRepositorySince(
    repositoryId: string,
    sinceISO: string,
    tx?: AppDatabase,
  ): Promise<number> {
    const row = await this.exec(tx)
      .selectFrom('github.commits')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('repositoryId', '=', repositoryId)
      .where('authoredAt', '>=', new Date(sinceISO))
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row?.count ?? 0;
  }

  async findWithCollaborators(input: {
    repositoryId: string;
    limit: number;
  }): Promise<
    Array<{
      commit: GithubCommitSelect;
      author: GithubCollaboratorSelect | null;
      committer: GithubCollaboratorSelect | null;
    }>
  > {
    const rows = await this.db
      .selectFrom('github.commits as c')
      .leftJoin('github.collaborators as a', (join) =>
        join
          .onRef('a.githubUserId', '=', 'c.authorGithubUserId')
          .on('a.deletedAt', 'is', null),
      )
      .leftJoin('github.collaborators as cm', (join) =>
        join
          .onRef('cm.githubUserId', '=', 'c.committerGithubUserId')
          .on('cm.deletedAt', 'is', null),
      )
      .selectAll('c')
      .select([
        'a.id as aId',
        'a.githubUserId as aGithubUserId',
        'a.login as aLogin',
        'a.nodeId as aNodeId',
        'a.avatarUrl as aAvatarUrl',
        'a.htmlUrl as aHtmlUrl',
        'a.type as aType',
        'a.siteAdmin as aSiteAdmin',
        'a.raw as aRaw',
        'a.createdAt as aCreatedAt',
        'a.updatedAt as aUpdatedAt',
        'a.deletedAt as aDeletedAt',
        'cm.id as cmId',
        'cm.githubUserId as cmGithubUserId',
        'cm.login as cmLogin',
        'cm.nodeId as cmNodeId',
        'cm.avatarUrl as cmAvatarUrl',
        'cm.htmlUrl as cmHtmlUrl',
        'cm.type as cmType',
        'cm.siteAdmin as cmSiteAdmin',
        'cm.raw as cmRaw',
        'cm.createdAt as cmCreatedAt',
        'cm.updatedAt as cmUpdatedAt',
        'cm.deletedAt as cmDeletedAt',
      ])
      .where('c.repositoryId', '=', input.repositoryId)
      .where('c.deletedAt', 'is', null)
      .orderBy('c.authoredAt', 'desc')
      .limit(input.limit)
      .execute();

    return rows.map((row) => {
      const {
        aId,
        aGithubUserId,
        aLogin,
        aNodeId,
        aAvatarUrl,
        aHtmlUrl,
        aType,
        aSiteAdmin,
        aRaw,
        aCreatedAt,
        aUpdatedAt,
        aDeletedAt,
        cmId,
        cmGithubUserId,
        cmLogin,
        cmNodeId,
        cmAvatarUrl,
        cmHtmlUrl,
        cmType,
        cmSiteAdmin,
        cmRaw,
        cmCreatedAt,
        cmUpdatedAt,
        cmDeletedAt,
        ...commit
      } = row;
      return {
        commit,
        author:
          aId === null
            ? null
            : {
                id: aId,
                githubUserId: aGithubUserId as bigint,
                login: aLogin as string,
                nodeId: aNodeId,
                avatarUrl: aAvatarUrl,
                htmlUrl: aHtmlUrl,
                type: aType,
                siteAdmin: aSiteAdmin as boolean,
                raw: aRaw,
                createdAt: aCreatedAt as Date,
                updatedAt: aUpdatedAt as Date,
                deletedAt: aDeletedAt,
              },
        committer:
          cmId === null
            ? null
            : {
                id: cmId,
                githubUserId: cmGithubUserId as bigint,
                login: cmLogin as string,
                nodeId: cmNodeId,
                avatarUrl: cmAvatarUrl,
                htmlUrl: cmHtmlUrl,
                type: cmType,
                siteAdmin: cmSiteAdmin as boolean,
                raw: cmRaw,
                createdAt: cmCreatedAt as Date,
                updatedAt: cmUpdatedAt as Date,
                deletedAt: cmDeletedAt,
              },
      };
    });
  }

  /**
   * Every commit of the period, newest first — the numbers a brief reports
   * (commit count, distinct contributors, `brief_commits` links) are all built
   * from this, so it pages rather than stopping at a fixed row count. It used to
   * default to `limit: 5000` with no caller passing one, which meant a busier
   * period produced a brief that reported 5000 of its commits and said nothing
   * about the rest. `limit` still means a single bounded read for a caller that
   * wants one.
   *
   * ponytail: the whole period is now resident at once, and these rows carry
   * their analysis summaries — a far higher ceiling than 5000 rows, but a real
   * one (worker heap). Upgrade path when it bites: stream each page into the
   * prompt builder and aggregate the counts in SQL, so only running totals stay
   * in memory.
   */
  async findForBriefScope(
    input: BriefScopeQuery & { limit?: number },
  ): Promise<BriefScopeCommit[]> {
    if (input.repositoryIds.length === 0) return [];
    if (this.selectsNoAuthors(input.collaboratorGithubUserIds)) return [];
    const pageSize = input.limit ?? BRIEF_SCOPE_PAGE_ROWS;
    const out: BriefScopeCommit[] = [];
    for (;;) {
      const last = out[out.length - 1]?.commit;
      const page = await this.findBriefScopePage(
        input,
        pageSize,
        last && { authoredAt: last.authoredAt, id: last.id },
      );
      out.push(...page);
      if (input.limit !== undefined || page.length < pageSize) return out;
    }
  }

  /**
   * `branch` narrows to commits seen on that branch (`github.commit_branches`).
   * Written as EXISTS rather than a join: a commit sits on several branches, and
   * a join would multiply the row out once per matching branch.
   *
   * Keyset on `(authoredAt, id)`, like `findPageByRepositorySince` — `id` breaks
   * ties because a pushed batch shares an `authoredAt`, and a timestamp-only
   * cursor either skips or repeats those rows at the page boundary. The
   * comparison points the other way there: this query is newest-first.
   *
   * The keyset stays on `authoredAt` whatever `commitClock` is. It only has to
   * be a total order over the filtered set, which it is either way — the clock
   * chooses which rows are in the set, not how they are walked.
   */
  private async findBriefScopePage(
    input: BriefScopeQuery,
    limit: number,
    after?: { authoredAt: Date; id: string },
  ): Promise<BriefScopeCommit[]> {
    const clock = `c.${commitClockColumn(input.commitClock)}` as const;
    let query = this.exec(input.tx)
      .selectFrom('github.commits as c')
      .leftJoin('github.commitAnalyses as a', 'a.commitId', 'c.id')
      .selectAll('c')
      .select([
        'a.id as aId',
        'a.commitId as aCommitId',
        'a.commitType as aCommitType',
        'a.summary as aSummary',
        'a.changes as aChanges',
        'a.status as aStatus',
        'a.failureReason as aFailureReason',
        'a.model as aModel',
        'a.promptTokens as aPromptTokens',
        'a.completionTokens as aCompletionTokens',
        'a.diffCharsSent as aDiffCharsSent',
        'a.diffWasTruncated as aDiffWasTruncated',
        'a.additions as aAdditions',
        'a.deletions as aDeletions',
        'a.analyzedAt as aAnalyzedAt',
        'a.createdAt as aCreatedAt',
        'a.updatedAt as aUpdatedAt',
        'a.deletedAt as aDeletedAt',
      ])
      .where('c.repositoryId', 'in', input.repositoryIds)
      .where(clock, '>=', input.periodStart)
      // Half-open: `periodEnd` is the next period's start, so `<=` would put a
      // commit stamped at exactly that instant in two consecutive briefs.
      .where(clock, '<', input.periodEnd)
      .where('c.deletedAt', 'is', null)
      .where('c.parentCount', '=', 1);
    if (input.collaboratorGithubUserIds) {
      query = query.where(
        'c.authorGithubUserId',
        'in',
        input.collaboratorGithubUserIds,
      );
    }
    const branch = input.branch;
    if (branch !== undefined) {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('github.commitBranches as cb')
            .select('cb.id')
            .whereRef('cb.commitId', '=', 'c.id')
            .where('cb.branch', '=', branch),
        ),
      );
    }
    if (after) {
      query = query.where((eb) =>
        eb.or([
          eb('c.authoredAt', '<', after.authoredAt),
          eb.and([
            eb('c.authoredAt', '=', after.authoredAt),
            eb('c.id', '<', after.id),
          ]),
        ]),
      );
    }
    const rows = await query
      .orderBy('c.authoredAt', 'desc')
      .orderBy('c.id', 'desc')
      .limit(limit)
      .execute();

    return rows.map((row) => {
      const {
        aId,
        aCommitId,
        aCommitType,
        aSummary,
        aChanges,
        aStatus,
        aFailureReason,
        aModel,
        aPromptTokens,
        aCompletionTokens,
        aDiffCharsSent,
        aDiffWasTruncated,
        aAdditions,
        aDeletions,
        aAnalyzedAt,
        aCreatedAt,
        aUpdatedAt,
        aDeletedAt,
        ...commit
      } = row;
      return {
        commit,
        analysis:
          aId === null
            ? null
            : {
                id: aId,
                commitId: aCommitId as string,
                commitType: aCommitType,
                summary: aSummary,
                changes: aChanges,
                status: aStatus as GithubCommitAnalysisStatus,
                failureReason: aFailureReason,
                model: aModel,
                promptTokens: aPromptTokens,
                completionTokens: aCompletionTokens,
                diffCharsSent: aDiffCharsSent,
                diffWasTruncated: aDiffWasTruncated as boolean,
                additions: aAdditions,
                deletions: aDeletions,
                analyzedAt: aAnalyzedAt as Date,
                createdAt: aCreatedAt as Date,
                updatedAt: aUpdatedAt as Date,
                deletedAt: aDeletedAt,
              },
      };
    });
  }

  /**
   * The period's commit timestamps, on the brief's own clock — both the bound
   * and the returned value, or a caller bucketing them would place commits
   * outside the window it asked for.
   */
  async findCommitTimestampsForScope(input: {
    repositoryIds: string[];
    periodStart: Date;
    periodEnd: Date;
    commitClock: BriefCommitClock;
    collaboratorGithubUserIds?: bigint[];
    branch?: string;
    tx?: AppDatabase;
  }): Promise<Date[]> {
    if (input.repositoryIds.length === 0) return [];
    if (this.selectsNoAuthors(input.collaboratorGithubUserIds)) return [];
    const clock = commitClockColumn(input.commitClock);
    let query = this.exec(input.tx)
      .selectFrom('github.commits')
      .select(clock)
      .where('repositoryId', 'in', input.repositoryIds)
      .where(clock, '>=', input.periodStart)
      // Half-open, like `findBriefScopePage` — the two must select the same set.
      .where(clock, '<', input.periodEnd)
      .where('deletedAt', 'is', null)
      .where('parentCount', '=', 1);
    if (input.collaboratorGithubUserIds) {
      query = query.where(
        'authorGithubUserId',
        'in',
        input.collaboratorGithubUserIds,
      );
    }
    query = this.applyBranchFilter(query, input.branch);
    const rows = await query.execute();
    return rows.map((r) => r[clock]);
  }

  /**
   * `landedAt`, matching the clock every brief is now generated on. These two
   * bound `planBackfill`'s range, and a bound on a slower clock reintroduces
   * exactly the bug the landed clock exists to kill: a scope whose newest work
   * all arrived by merge commit has `max(committed_at) < max(landed_at)`, so
   * `activeUpper` stops short and the trailing windows get no backfill brief.
   *
   * Safe to move: `landed_at` is seeded from `committed_at` for imported history
   * and stamped at read time otherwise, so it is never the earlier of the two
   * and the range can only widen.
   */
  async findOldestCommitTimestampForScope(input: {
    repositoryIds: string[];
    since: Date;
    collaboratorGithubUserIds?: bigint[];
    branch?: string;
    tx?: AppDatabase;
  }): Promise<Date | null> {
    if (input.repositoryIds.length === 0) return null;
    if (this.selectsNoAuthors(input.collaboratorGithubUserIds)) return null;
    let query = this.exec(input.tx)
      .selectFrom('github.commits')
      .select('landedAt')
      .where('repositoryId', 'in', input.repositoryIds)
      .where('landedAt', '>=', input.since)
      .where('deletedAt', 'is', null)
      .where('parentCount', '=', 1);
    if (input.collaboratorGithubUserIds) {
      query = query.where(
        'authorGithubUserId',
        'in',
        input.collaboratorGithubUserIds,
      );
    }
    query = this.applyBranchFilter(query, input.branch);
    const row = await query
      .orderBy('landedAt', 'asc')
      .limit(1)
      .executeTakeFirst();
    return row?.landedAt ?? null;
  }

  async findNewestCommitTimestampForScope(input: {
    repositoryIds: string[];
    since: Date;
    collaboratorGithubUserIds?: bigint[];
    branch?: string;
    tx?: AppDatabase;
  }): Promise<Date | null> {
    if (input.repositoryIds.length === 0) return null;
    if (this.selectsNoAuthors(input.collaboratorGithubUserIds)) return null;
    let query = this.exec(input.tx)
      .selectFrom('github.commits')
      .select('landedAt')
      .where('repositoryId', 'in', input.repositoryIds)
      .where('landedAt', '>=', input.since)
      .where('deletedAt', 'is', null)
      .where('parentCount', '=', 1);
    if (input.collaboratorGithubUserIds) {
      query = query.where(
        'authorGithubUserId',
        'in',
        input.collaboratorGithubUserIds,
      );
    }
    query = this.applyBranchFilter(query, input.branch);
    const row = await query
      .orderBy('landedAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.landedAt ?? null;
  }
}
