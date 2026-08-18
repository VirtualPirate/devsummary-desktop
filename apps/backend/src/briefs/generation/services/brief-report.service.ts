import { Injectable } from '@nestjs/common';
import { zonedStartOfDay } from '../../schedules/services/cadence.service';
import {
  WORK_CATEGORIES,
  WORK_CATEGORY_OF,
  type BriefCommitType,
  type BriefReportContributor,
  type BriefReportDay,
  type BriefReportResponse,
  type WorkCategory,
} from '@launchstack/api-interfaces';
import { AppError } from '../../../common/errors';
import { BriefsRepository } from '../repositories/briefs.repository';
import {
  BriefReportRepository,
  type ContributorBucketRow,
  type DailyBucketRow,
  type ReportDay,
} from '../repositories/brief-report.repository';
import { BriefScopeResolver, type BriefScope } from './brief-scope.resolver';

type CountsByCategory = BriefReportDay['counts'];

function emptyCounts(): CountsByCategory {
  const counts = { unclassified: 0 } as CountsByCategory;
  for (const c of WORK_CATEGORIES) counts[c] = 0;
  return counts;
}

function categoryOf(commitType: string | null): WorkCategory | 'unclassified' {
  if (!commitType) return 'unclassified';
  return WORK_CATEGORY_OF[commitType as BriefCommitType] ?? 'unclassified';
}

/**
 * Ratio change, or null when there is nothing to compare against. A previous
 * period of zero has no meaningful percentage — "+∞%" is worse than no figure.
 */
function ratio(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/** YYYY-MM-DD for a bucket instant, in the report's timezone. */
function dayKey(d: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the key format we want.
  return d.toLocaleDateString('en-CA', { timeZone: timezone });
}

/**
 * Every calendar day the period touches, in the report's timezone, both ends
 * inclusive — the exact set of x-axis points the day charts may draw.
 *
 * Two details earn their keep:
 *
 * - The last day comes from `periodEnd - 1ms`, because `periodEnd` is
 *   exclusive. A cadence period ends exactly at the next local midnight, which
 *   belongs to the following day; taking `periodEnd` verbatim would add an
 *   empty eighth column to every weekly brief.
 * - The cursor steps calendar dates, not 24-hour instants. Across a DST change
 *   a local day is 23 or 25 hours, which makes fixed-millisecond stepping skip
 *   or repeat a day.
 */
function dayKeysInPeriod(
  periodStart: Date,
  periodEnd: Date,
  timezone: string,
): string[] {
  const first = dayKey(periodStart, timezone);
  const last = dayKey(new Date(periodEnd.getTime() - 1), timezone);
  const keys: string[] = [];
  const cursor = new Date(`${first}T00:00:00Z`);
  const end = new Date(`${last}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

/**
 * The period's days as absolute instant ranges, resolved here rather than in
 * SQL. Keeping the zone name out of Postgres means a legacy alias like
 * `Asia/Calcutta` — accepted by every JS runtime, rejected by a Postgres without
 * `tzdata-legacy` — can no longer take the whole report down.
 *
 * Boundaries come from `CadenceService`'s own primitive, not `date-fns-tz`.
 * They have to be resolved *identically* to the brief's `period_start` /
 * `period_end` or the report stops tiling its own period: `fromZonedTime`
 * resolves a midnight that does not exist (a zone that springs forward at 00:00)
 * to the hour before the gap, which left the last day's range ending an hour
 * before the period did and dropped that hour of commits from the final column.
 */
function reportDays(
  periodStart: Date,
  periodEnd: Date,
  timezone: string,
): ReportDay[] {
  const keys = dayKeysInPeriod(periodStart, periodEnd, timezone);
  return keys.map((key) => ({
    key,
    from: zonedStartOfDay(key, timezone),
    // The next local midnight — derived from the next calendar date, not by
    // adding 24 hours, so a DST day of 23 or 25 hours still tiles exactly.
    to: zonedStartOfDay(nextDayKey(key), timezone),
  }));
}

/** The calendar date after a YYYY-MM-DD key. */
function nextDayKey(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class BriefReportService {
  constructor(
    private readonly briefs: BriefsRepository,
    private readonly scopeResolver: BriefScopeResolver,
    private readonly report: BriefReportRepository,
  ) {}

  async build(
    organizationId: string,
    briefId: string,
  ): Promise<BriefReportResponse> {
    const brief = await this.briefs.findByIdScopedToOrg(
      briefId,
      organizationId,
    );
    if (!brief) throw AppError.BRIEF_NOT_FOUND();

    // The brief's own snapshot, never the schedule's current timezone: the
    // boundaries below were frozen in this zone at generation, and the
    // schedule's is editable. Reading the live row re-tiled every historical
    // report after an edit — partial first/last day columns, and a day total
    // that no longer summed to the stored `commit_count`.
    const timezone = brief.periodTimezone;
    // Same rule for the clock: the brief was generated selecting on this
    // column, and the report re-queries live. Assuming today's clock would
    // print totals contradicting the `commit_count` on the brief itself.
    const commitClock = brief.commitClock;
    const periodStart = brief.periodStart;
    const periodEnd = brief.periodEnd;

    // ponytail: the scope is resolved as it stands today, so a project that
    // gained or lost repositories after generation reports figures that can
    // disagree with the stored prose. Snapshot the resolved repository ids on
    // the brief row if that drift ever becomes a real complaint.
    let repositoryIds: string[];
    let authorFilter: bigint[] | undefined;
    let branchFilter: string | undefined;
    try {
      const resolved = await this.scopeResolver.resolve({
        organizationId,
        scope: this.scopeFromBrief(brief),
      });
      repositoryIds = resolved.repositoryIds;
      authorFilter = resolved.authorFilter;
      branchFilter = resolved.branchFilter;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('SCOPE_DELETED')) {
        return this.emptyReport(briefId, timezone, periodStart, periodEnd);
      }
      throw err;
    }

    if (repositoryIds.length === 0) {
      return this.emptyReport(briefId, timezone, periodStart, periodEnd);
    }

    // The true period length: `periodEnd` is exclusive, so this is exactly the
    // span the brief covers (it used to be 1ms short of it).
    const lengthMs = periodEnd.getTime() - periodStart.getTime();
    const previousStart = new Date(periodStart.getTime() - lengthMs);
    const currentWindow = {
      repositoryIds,
      authorFilter,
      branchFilter,
      commitClock,
      from: periodStart,
      to: periodEnd,
    };
    const days = reportDays(periodStart, periodEnd, timezone);

    const [dailyRows, previousTotals, contributorRows, repositoryRows] =
      await Promise.all([
        this.report.dailyBuckets({ ...currentWindow, days }),
        this.report.periodTotals({
          repositoryIds,
          authorFilter,
          branchFilter,
          commitClock,
          from: previousStart,
          // `to` is exclusive, so `periodStart` itself belongs to the current
          // window and the two tile with no gap.
          to: periodStart,
        }),
        this.report.contributorBuckets({
          repositoryIds,
          authorFilter,
          branchFilter,
          commitClock,
          from: previousStart,
          to: periodEnd,
          currentFrom: periodStart,
        }),
        this.report.repositoryTotals(currentWindow),
      ]);

    const daily = this.buildDaily(dailyRows, days);
    const contributors = this.buildContributors(
      contributorRows.filter((r) => r.window === 0),
    );
    const previousContributors = contributorRows.filter(
      (r) => r.window === 1,
    ).length;

    const sum = (rows: DailyBucketRow[], key: keyof DailyBucketRow) =>
      rows.reduce((n, r) => n + (r[key] as number), 0);

    const totalCommits = sum(dailyRows, 'commits');
    const linesAdded = sum(dailyRows, 'additions');
    const linesRemoved = sum(dailyRows, 'deletions');

    const busiest = daily.reduce<{ date: string; commits: number } | null>(
      (best, d) => {
        const commits = Object.values(d.counts).reduce((n, v) => n + v, 0);
        if (commits === 0) return best;
        return !best || commits > best.commits
          ? { date: d.date, commits }
          : best;
      },
      null,
    );

    return {
      briefId,
      scopeDeleted: false,
      timezone,
      totals: {
        commits: totalCommits,
        contributors: contributors.length,
        repositoriesTouched: repositoryRows.length,
        repositoriesInScope: repositoryIds.length,
        linesAdded,
        linesRemoved,
        busiestDay: busiest,
      },
      deltas: {
        commits: ratio(totalCommits, previousTotals.commits),
        contributors:
          previousContributors === 0
            ? null
            : contributors.length - previousContributors,
        linesAdded: ratio(linesAdded, previousTotals.additions),
        linesRemoved: ratio(linesRemoved, previousTotals.deletions),
      },
      daily,
      workBreakdown: this.buildWorkBreakdown(dailyRows),
      contributors,
      repositories: repositoryRows.map((r) => ({
        repositoryId: r.repositoryId,
        fullName: r.fullName,
        commits: r.commits,
        linesAdded: r.additions,
        linesRemoved: r.deletions,
      })),
      locCoverage: {
        withLoc: sum(dailyRows, 'withLoc'),
        total: totalCommits,
      },
    };
  }

  private buildDaily(
    rows: DailyBucketRow[],
    days: ReportDay[],
  ): BriefReportDay[] {
    const byDay = new Map<string, BriefReportDay>();
    // Zero-fill first so every day in the period exists even with no commits.
    // `days` is also what the query grouped by, so the x axis is exactly the
    // brief's own date range — a row can neither invent nor miss a day.
    for (const { key } of days) {
      byDay.set(key, {
        date: key,
        counts: emptyCounts(),
        linesAdded: 0,
        linesRemoved: 0,
      });
    }
    for (const row of rows) {
      const day = byDay.get(row.day);
      if (!day) continue;
      day.counts[categoryOf(row.commitType)] += row.commits;
      day.linesAdded += row.additions;
      day.linesRemoved += row.deletions;
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  private buildWorkBreakdown(
    rows: DailyBucketRow[],
  ): Array<{ category: WorkCategory; commits: number }> {
    const totals = new Map<WorkCategory, number>();
    for (const row of rows) {
      const category = categoryOf(row.commitType);
      if (category === 'unclassified') continue;
      totals.set(category, (totals.get(category) ?? 0) + row.commits);
    }
    return WORK_CATEGORIES.filter((c) => (totals.get(c) ?? 0) > 0)
      .map((c) => ({ category: c, commits: totals.get(c) as number }))
      .sort((a, b) => b.commits - a.commits);
  }

  private buildContributors(
    rows: ContributorBucketRow[],
  ): BriefReportContributor[] {
    return rows
      .map((r) => ({
        collaboratorId: r.collaboratorId,
        login: r.login,
        name: r.name,
        avatarUrl: r.avatarUrl,
        // The collaborator row is authoritative; the login suffix is the
        // fallback for bots that never appear in the collaborator list.
        isBot:
          r.collaboratorType === 'Bot' || (r.login ?? '').endsWith('[bot]'),
        commits: r.commits,
        repositories: r.repositories,
      }))
      .sort((a, b) => b.commits - a.commits);
  }

  private scopeFromBrief(brief: {
    scopeType: string;
    scopeProjectId: string | null;
    scopeTeamId: string | null;
    scopeCollaboratorId: string | null;
    scopeRepositoryId: string | null;
    scopeBranch: string | null;
  }): BriefScope {
    if (brief.scopeType === 'project')
      return { type: 'project', projectId: brief.scopeProjectId as string };
    if (brief.scopeType === 'team')
      return { type: 'team', teamId: brief.scopeTeamId as string };
    if (brief.scopeType === 'collaborator')
      return {
        type: 'collaborator',
        collaboratorId: brief.scopeCollaboratorId as string,
      };
    return {
      type: 'repository',
      repositoryId: brief.scopeRepositoryId as string,
      ...(brief.scopeBranch ? { branch: brief.scopeBranch } : {}),
    };
  }

  private emptyReport(
    briefId: string,
    timezone: string,
    periodStart: Date,
    periodEnd: Date,
  ): BriefReportResponse {
    return {
      briefId,
      scopeDeleted: true,
      timezone,
      totals: {
        commits: 0,
        contributors: 0,
        repositoriesTouched: 0,
        repositoriesInScope: 0,
        linesAdded: 0,
        linesRemoved: 0,
        busiestDay: null,
      },
      deltas: {
        commits: null,
        contributors: null,
        linesAdded: null,
        linesRemoved: null,
      },
      daily: this.buildDaily([], reportDays(periodStart, periodEnd, timezone)),
      workBreakdown: [],
      contributors: [],
      repositories: [],
      locCoverage: { withLoc: 0, total: 0 },
    };
  }
}
