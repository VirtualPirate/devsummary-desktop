import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  commitClockRef,
  KYSELY_DB,
  type AppDatabase,
  type BriefCommitClock,
} from '../../../databases/kysely';

/**
 * The window every query runs over, **half-open**: `from` inclusive, `to`
 * exclusive, matching `PeriodWindow`. `from`/`to` are absolute instants;
 * callers widen `from` by one period to fetch the previous period in the same
 * pass, and a period's `to` is exactly the next period's `from`.
 *
 * `authorFilter` mirrors `ResolvedScope.authorFilter`: `undefined` means "no
 * author restriction", `[]` means the scope selects nobody. The two are not
 * interchangeable — collapsing them widens a memberless team to every author.
 */
export interface ScopeEntity {
  repositoryIds: string[];
  authorFilter?: bigint[];
  /**
   * Mirrors `ResolvedScope.branchFilter`: `undefined` means every branch. A
   * branch-scoped brief whose report counted every branch would print totals
   * that contradict its own summary, so every query here honours it.
   */
  branchFilter?: string;
  /**
   * The clock snapshotted on the brief (`brief.commitClock`), never a constant:
   * a report re-queries live, so bounding on a different column than the brief
   * was generated with prints totals contradicting its own `commit_count`.
   * Resolved to a fixed identifier by `commitClockRef` — it is never
   * interpolated.
   */
  commitClock: BriefCommitClock;
}

export interface ScopeWindow extends ScopeEntity {
  from: Date;
  to: Date;
}

/**
 * One calendar day of the report, as an absolute instant range. The caller
 * resolves local midnights into instants, so no query here ever names a
 * timezone.
 *
 * That matters: a schedule may legitimately store a legacy zone alias such as
 * `Asia/Calcutta`, which every JS runtime accepts but a Postgres built against
 * split tzdata (no `tzdata-legacy`) rejects outright — `at time zone
 * 'Asia/Calcutta'` raises `time zone not recognized` and takes the whole report
 * down. Instants have no such failure mode.
 */
export interface ReportDay {
  /** YYYY-MM-DD in the report's timezone. */
  key: string;
  /** Local midnight, inclusive. */
  from: Date;
  /** Local midnight of the next day, exclusive. */
  to: Date;
}

export interface DailyBucketRow {
  /** The `key` of the `ReportDay` this row belongs to. */
  day: string;
  /** github commit_type, or null when there is no usable analysis. */
  commitType: string | null;
  commits: number;
  additions: number;
  deletions: number;
  /** Commits in this bucket that carry line stats. */
  withLoc: number;
}

export interface PeriodTotalRow {
  commits: number;
  additions: number;
  deletions: number;
}

export interface ContributorBucketRow {
  /** 0 = the current period, 1 = the previous period. */
  window: number;
  collaboratorId: string | null;
  login: string | null;
  name: string;
  avatarUrl: string | null;
  collaboratorType: string | null;
  commits: number;
  repositories: number;
}

export interface RepositoryTotalRow {
  repositoryId: string;
  fullName: string;
  commits: number;
  additions: number;
  deletions: number;
}

export interface PreviewTotalsRow {
  commits: number;
  contributors: number;
  /** Repositories that actually contributed a commit, not the scope's size. */
  repositories: number;
}

export interface PreviewTypeRow {
  /** `null` when the commit carries no usable analysis yet. */
  commitType: string | null;
  commits: number;
}

export interface ScopeBoundsRow {
  earliest: Date | null;
  latest: Date | null;
}

@Injectable()
export class BriefReportRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  /**
   * `parent_count = 1` and the author filter mirror
   * `CommitsRepository.findForBriefScope`, which is what produced
   * `brief.commit_count`. Diverging here would print a different total from
   * the brief this report belongs to.
   */
  private entityClause(input: ScopeEntity) {
    const authorClause =
      input.authorFilter === undefined
        ? sql``
        : sql` and c.author_github_user_id in (${sql.join(
            input.authorFilter.map((id) => sql`${id}`),
          )})`;
    // EXISTS, not a join: a commit sits on every branch that can reach it, and
    // joining would count it once per matching branch.
    const branchClause =
      input.branchFilter === undefined
        ? sql``
        : sql` and exists (
            select 1 from github.commit_branches cb
            where cb.commit_id = c.id and cb.branch = ${input.branchFilter}
          )`;
    return sql`
      c.repository_id in (${sql.join(input.repositoryIds.map((id) => sql`${id}`))})
      and c.deleted_at is null
      and c.parent_count = 1
      ${authorClause}
      ${branchClause}
    `;
  }

  private scopePredicate(input: ScopeWindow) {
    // Half-open on the brief's own clock: `>= from`, `< to`. `to` is the next
    // period's `from`, so `<=` would put a commit at exactly that instant in two
    // consecutive briefs.
    const clock = commitClockRef(input.commitClock);
    return sql`
      ${this.entityClause(input)}
      and ${clock} >= ${input.from}
      and ${clock} < ${input.to}
    `;
  }

  /** True when the window can only ever be empty; callers skip the round trip. */
  private selectsNothing(input: ScopeEntity): boolean {
    return (
      input.repositoryIds.length === 0 ||
      (input.authorFilter !== undefined && input.authorFilter.length === 0)
    );
  }

  /**
   * Commits per calendar day per type. Days arrive as instant ranges and are
   * joined as a VALUES list, so the grouping is exactly the set of days the
   * caller asked for — a commit cannot land in a day the report does not draw.
   */
  async dailyBuckets(
    input: ScopeWindow & { days: ReportDay[] },
  ): Promise<DailyBucketRow[]> {
    if (this.selectsNothing(input) || input.days.length === 0) return [];
    const days = sql.join(
      input.days.map(
        (d) => sql`(${d.key}, ${d.from}::timestamptz, ${d.to}::timestamptz)`,
      ),
    );
    const rows = await sql<DailyBucketRow>`
      select
        d.key as day,
        case when a.status = 'analyzed' then a.commit_type end as "commitType",
        count(*)::int as commits,
        coalesce(sum(a.additions), 0)::int as additions,
        coalesce(sum(a.deletions), 0)::int as deletions,
        count(*) filter (where a.additions is not null)::int as "withLoc"
      from (values ${days}) as d(key, lo, hi)
      join github.commits c
        on ${commitClockRef(input.commitClock)} >= d.lo
       and ${commitClockRef(input.commitClock)} < d.hi
      left join github.commit_analyses a
        on a.commit_id = c.id and a.deleted_at is null
      where ${this.scopePredicate(input)}
      group by 1, 2
    `.execute(this.db);
    return rows.rows;
  }

  /**
   * Flat totals for one window, no bucketing. This is what the previous period
   * contributes to the deltas: comparing whole windows as instant ranges avoids
   * ever having to decide which window a shared calendar day belongs to.
   */
  async periodTotals(input: ScopeWindow): Promise<PeriodTotalRow> {
    const empty = { commits: 0, additions: 0, deletions: 0 };
    if (this.selectsNothing(input)) return empty;
    const rows = await sql<PeriodTotalRow>`
      select
        count(*)::int as commits,
        coalesce(sum(a.additions), 0)::int as additions,
        coalesce(sum(a.deletions), 0)::int as deletions
      from github.commits c
      left join github.commit_analyses a
        on a.commit_id = c.id and a.deleted_at is null
      where ${this.scopePredicate(input)}
    `.execute(this.db);
    return rows.rows[0] ?? empty;
  }

  /**
   * Both periods in one pass: the previous period's distinct-author count is
   * the only source for `deltas.contributors`.
   *
   * Authors are grouped by github user id when known and by name otherwise,
   * matching how `BriefGeneratorService` counts distinct contributors.
   */
  async contributorBuckets(
    input: ScopeWindow & { currentFrom: Date },
  ): Promise<ContributorBucketRow[]> {
    if (this.selectsNothing(input)) return [];
    const rows = await sql<ContributorBucketRow>`
      select
        case when ${commitClockRef(input.commitClock)} >= ${input.currentFrom}
          then 0 else 1 end as window,
        col.id as "collaboratorId",
        c.author_github_login as login,
        max(c.author_name) as name,
        max(col.avatar_url) as "avatarUrl",
        max(col.type) as "collaboratorType",
        count(*)::int as commits,
        count(distinct c.repository_id)::int as repositories
      from github.commits c
      left join github.collaborators col
        on col.github_user_id = c.author_github_user_id
       and col.deleted_at is null
      where ${this.scopePredicate(input)}
      group by 1, col.id, c.author_github_login,
               coalesce(c.author_github_login, c.author_name)
      order by commits desc
    `.execute(this.db);
    return rows.rows;
  }

  /**
   * Headline counts for a period that has no brief yet. Runs through the same
   * `scopePredicate` as the generator, so the number shown before pressing
   * Generate is the `commit_count` the brief comes back with.
   *
   * Contributors are grouped by github login falling back to name, matching
   * `contributorBuckets` and `BriefGeneratorService`.
   */
  async previewTotals(input: ScopeWindow): Promise<PreviewTotalsRow> {
    const empty = { commits: 0, contributors: 0, repositories: 0 };
    if (this.selectsNothing(input)) return empty;
    const rows = await sql<PreviewTotalsRow>`
      select
        count(*)::int as commits,
        count(distinct coalesce(c.author_github_login, c.author_name))::int
          as contributors,
        count(distinct c.repository_id)::int as repositories
      from github.commits c
      where ${this.scopePredicate(input)}
    `.execute(this.db);
    return rows.rows[0] ?? empty;
  }

  /**
   * Commits per type for the same window. Grouped rather than counted per known
   * type so a commit_type added to the enum later still lands somewhere instead
   * of silently vanishing from the total.
   */
  async previewTypeBuckets(input: ScopeWindow): Promise<PreviewTypeRow[]> {
    if (this.selectsNothing(input)) return [];
    const rows = await sql<PreviewTypeRow>`
      select
        case when a.status = 'analyzed' then a.commit_type end as "commitType",
        count(*)::int as commits
      from github.commits c
      left join github.commit_analyses a
        on a.commit_id = c.id and a.deleted_at is null
      where ${this.scopePredicate(input)}
      group by 1
    `.execute(this.db);
    return rows.rows;
  }

  /**
   * The scope's whole ingested history, ignoring any period — this is what
   * bounds a useful custom range, and it is the only thing that can explain an
   * empty period ("nothing since June") rather than just reporting zero.
   *
   * Same clock as selection, deliberately: a range picker bounded by author
   * dates would offer a start no brief on the committer clock can ever reach.
   */
  async scopeBounds(input: ScopeEntity): Promise<ScopeBoundsRow> {
    const empty = { earliest: null, latest: null };
    if (this.selectsNothing(input)) return empty;
    const clock = commitClockRef(input.commitClock);
    const rows = await sql<ScopeBoundsRow>`
      select min(${clock}) as earliest, max(${clock}) as latest
      from github.commits c
      where ${this.entityClause(input)}
    `.execute(this.db);
    return rows.rows[0] ?? empty;
  }

  async repositoryTotals(input: ScopeWindow): Promise<RepositoryTotalRow[]> {
    if (this.selectsNothing(input)) return [];
    const rows = await sql<RepositoryTotalRow>`
      select
        c.repository_id as "repositoryId",
        max(r.full_name) as "fullName",
        count(*)::int as commits,
        coalesce(sum(a.additions), 0)::int as additions,
        coalesce(sum(a.deletions), 0)::int as deletions
      from github.commits c
      join github.repositories r on r.id = c.repository_id
      left join github.commit_analyses a
        on a.commit_id = c.id and a.deleted_at is null
      where ${this.scopePredicate(input)}
      group by c.repository_id
      order by commits desc
    `.execute(this.db);
    return rows.rows;
  }
}
