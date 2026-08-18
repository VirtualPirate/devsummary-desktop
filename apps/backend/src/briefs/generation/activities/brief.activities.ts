import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_HISTORY_DAYS } from '@launchstack/api-interfaces';
import {
  KYSELY_DB,
  type AppDatabase,
  type BriefScheduleSelect,
} from '../../../databases/kysely';
import { CommitsRepository } from '../../../integrations/github/commit-analysis/repositories/commits.repository';
import { BRIEFS_CONFIG_TOKEN } from '../../tokens';
import type { BriefsConfig } from '../../briefs-config';
import { BriefDelivererService } from '../../delivery/services/brief-deliverer.service';
import { BriefSchedulesRepository } from '../../schedules/repositories/brief-schedules.repository';
import {
  CadenceService,
  type PeriodWindow,
} from '../../schedules/services/cadence.service';
import { BriefCommitsRepository } from '../repositories/brief-commits.repository';
import { BriefsRepository } from '../repositories/briefs.repository';
import {
  BriefGeneratorService,
  type BriefScope,
  type GenerateOutput,
} from '../services/brief-generator.service';
import {
  BriefScopeResolver,
  type ResolvedScope,
} from '../services/brief-scope.resolver';

const DEFAULT_DISPATCH_BATCH_SIZE = 100;
const DEFAULT_PENDING_REAP_MINUTES = 15;

// A schedule whose next_run_at sits far in the past (long outage, clock jump,
// hand-edited row) must not create an unbounded pile of briefs in one tick.
// Catch up at most this many periods per dispatch; the next tick continues.
const MAX_CATCHUP_PERIODS = 32;

// Pause a schedule after this many consecutive failed dispatches so it stops
// occupying a slot in the `next_run_at ASC` window shared with healthy orgs.
const MAX_DISPATCH_FAILURES = 5;

const PG_UNIQUE_VIOLATION = '23505';

interface ClaimedBrief {
  briefId: string;
  organizationId: string;
  deliver: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

@Injectable()
export class BriefActivities {
  private readonly logger = new Logger(BriefActivities.name);

  constructor(
    private readonly briefs: BriefsRepository,
    private readonly briefCommits: BriefCommitsRepository,
    private readonly generator: BriefGeneratorService,
    private readonly deliverer: BriefDelivererService,
    private readonly cadence: CadenceService,
    private readonly schedules: BriefSchedulesRepository,
    private readonly commits: CommitsRepository,
    private readonly scopeResolver: BriefScopeResolver,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
    @Inject(BRIEFS_CONFIG_TOKEN) private readonly config: BriefsConfig | null,
    private readonly env: ConfigService,
  ) {}

  async markGenerating(input: {
    briefId: string;
  }): Promise<{ proceed: boolean }> {
    const brief = await this.briefs.findById(input.briefId);
    if (!brief) {
      this.logger.warn(`brief ${input.briefId} not found`);
      return { proceed: false };
    }
    // `generating` proceeds too. Durability is now whole-handler retry, not
    // Temporal replay: the deduped `brief:<id>` job row is the single execution
    // authority, so a row that still exists means no run of this handler has
    // finished. A crash (or a plain quit) during `generateContent` left the
    // brief `generating`; boot requeued the job, this returned proceed:false,
    // the handler "succeeded", the row was deleted — and `reapStalePending`
    // only looks at `pending`, so the brief was wedged with no content forever.
    // `generated`/`delivered` still exit: those cost an LLM call to redo and
    // the brief detail view's per-channel button already re-sends them.
    if (
      brief.status !== 'pending' &&
      brief.status !== 'failed' &&
      brief.status !== 'generating'
    ) {
      this.logger.log(`brief ${brief.id} already ${brief.status}; exiting`);
      return { proceed: false };
    }

    await this.briefs.update(brief.id, { status: 'generating' });
    return { proceed: true };
  }

  async generateContent(input: {
    briefId: string;
  }): Promise<{ terminal: boolean }> {
    const brief = await this.briefs.findById(input.briefId);
    if (!brief) {
      this.logger.warn(`brief ${input.briefId} not found`);
      return { terminal: true };
    }

    const scope = this.scopeFromBrief(brief);
    // The period boundaries are local midnights in the zone snapshotted on the
    // brief, so every rendering of them — the stored label and the prompt — has
    // to use that zone. Formatting in UTC named the wrong start date for every
    // non-UTC schedule.
    const period = { start: brief.periodStart, end: brief.periodEnd };
    const timezone = brief.periodTimezone;
    let result: GenerateOutput;
    try {
      result = await this.generator.generate({
        organizationId: brief.organizationId,
        scope,
        period,
        timezone,
        // Same reasoning as the zone: the clock is snapshotted on the brief, so
        // a re-generated historical brief selects what it was written from.
        commitClock: brief.commitClock,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('SCOPE_DELETED')) {
        await this.briefs.update(brief.id, {
          status: 'failed',
          failureReason: message,
        });
        return { terminal: true };
      }
      await this.briefs.update(brief.id, {
        status: 'failed',
        failureReason: message,
      });
      throw err;
    }

    const periodLabel = this.cadence.formatPeriodLabel(period, timezone);

    if (result.kind === 'empty') {
      await this.briefs.update(brief.id, {
        status: 'generated',
        title: `${result.scopeLabel} — no activity`,
        briefInfoTitle: `${periodLabel} · 0 contributors · 0 commits`,
        summary: 'No activity in this period.',
        highlights: JSON.stringify([]),
        contributorCount: 0,
        commitCount: 0,
        generatedAt: new Date(),
      });
      await this.briefCommits.replaceForBrief(brief.id, []);
    } else {
      await this.briefs.update(brief.id, {
        status: 'generated',
        title: result.title,
        briefInfoTitle: `${periodLabel} · ${result.contributorCount} contributors · ${result.commitCount} commits`,
        summary: result.summary,
        highlights: JSON.stringify(result.highlights),
        contributorCount: result.contributorCount,
        commitCount: result.commitCount,
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        generatedAt: new Date(),
      });
      await this.briefCommits.replaceForBrief(brief.id, result.commits);
    }

    return { terminal: false };
  }

  async deliver(input: { briefId: string }): Promise<void> {
    await this.deliverer.deliver(input.briefId);
  }

  async planBackfill(input: {
    scheduleId: string;
    backfillMonths?: number;
  }): Promise<{
    briefs: Array<{ briefId: string; organizationId: string }>;
  }> {
    if (!this.config) {
      this.logger.warn('briefs generation not configured; skipping');
      return { briefs: [] };
    }

    const schedule = await this.schedules.findById(input.scheduleId);
    if (!schedule) {
      this.logger.warn(`schedule ${input.scheduleId} not found; skipping`);
      return { briefs: [] };
    }

    let resolved: ResolvedScope;
    try {
      resolved = await this.scopeResolver.resolve({
        organizationId: schedule.organizationId,
        scope: this.scopeFromSchedule(schedule),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`schedule ${schedule.id} scope unresolved: ${message}`);
      return { briefs: [] };
    }

    const now = new Date();
    // The caller picks how far back to go in months; the per-cadence window cap
    // below is still what bounds the fan-out. Callers that pass nothing (older
    // in-flight executions) keep the original whole-cap lookback.
    const requestedStart =
      input.backfillMonths === undefined
        ? this.cadence.backfillLookbackStart(
            schedule,
            now,
            this.config.backfillMaxBriefs,
          )
        : this.cadence.lookbackStartFromMonths(now, input.backfillMonths);
    // `MAX_HISTORY_DAYS` is the product ceiling, and this is the one place both
    // branches converge — clamp here rather than at each caller, or the legacy
    // branch alone reaches back `backfillMaxBriefs` *cadence units* (366 weeks
    // for a weekly schedule, seven years) and bills every window of it.
    const ceiling = new Date(
      now.getTime() - MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000,
    );
    const lookbackStart =
      requestedStart.getTime() < ceiling.getTime() ? ceiling : requestedStart;
    const firstLivePeriod = this.cadence.computePeriod(
      schedule,
      schedule.nextRunAt,
    );

    const oldest = await this.commits.findOldestCommitTimestampForScope({
      repositoryIds: resolved.repositoryIds,
      since: lookbackStart,
      collaboratorGithubUserIds: resolved.authorFilter,
      branch: resolved.branchFilter,
    });
    if (!oldest) {
      this.logger.log(
        `schedule ${schedule.id} has no commits in range; nothing to backfill`,
      );
      return { briefs: [] };
    }
    const newest = await this.commits.findNewestCommitTimestampForScope({
      repositoryIds: resolved.repositoryIds,
      branch: resolved.branchFilter,
      since: lookbackStart,
      collaboratorGithubUserIds: resolved.authorFilter,
    });

    const rangeStart = this.cadence.windowContaining(schedule, oldest).start;
    // Stop at the window that holds the most recent commit so we don't fill
    // the trailing stretch of inactivity up to today — but never spill into
    // the period the first live run will generate.
    // `end` is already exclusive — it IS the next window's start — so it is the
    // exclusive upper bound as-is. The old `+ 1ms` compensated for an inclusive
    // end and would now let `windowsInRange` in one window too far.
    const activeUpper = this.cadence.windowContaining(
      schedule,
      newest ?? oldest,
    ).end;
    const upperExclusive =
      activeUpper.getTime() < firstLivePeriod.start.getTime()
        ? activeUpper
        : firstLivePeriod.start;

    const existing = await this.briefs.findPeriodStartsForSchedule(
      schedule.id,
      rangeStart,
    );

    let windows = this.cadence
      .windowsInRange(schedule, rangeStart, upperExclusive)
      .sort((a, b) => b.start.getTime() - a.start.getTime());

    const cap = this.config.backfillMaxBriefs;
    if (windows.length > cap) {
      this.logger.warn(
        `schedule ${schedule.id}: ${windows.length} windows exceed cap ${cap}; dropping ${windows.length - cap} oldest`,
      );
      windows = windows.slice(0, cap);
    }

    windows = windows.filter((w) => !existing.has(w.start.getTime()));

    const created: Array<{ briefId: string; organizationId: string }> = [];
    for (const w of windows) {
      try {
        const briefRow = await this.briefs.create({
          organizationId: schedule.organizationId,
          briefScheduleId: schedule.id,
          scopeType: schedule.scopeType,
          scopeProjectId: schedule.scopeProjectId,
          scopeTeamId: schedule.scopeTeamId,
          scopeCollaboratorId: schedule.scopeCollaboratorId,
          scopeRepositoryId: schedule.scopeRepositoryId,
          scopeBranch: schedule.scopeBranch,
          periodStart: w.start,
          periodEnd: w.end,
          // Snapshot, not a lookup: `windowsInRange` cut these boundaries in
          // the schedule's zone as it stands now, and that zone is editable.
          periodTimezone: schedule.timezone,
          // A brief covers what landed on the tracked branch in the period —
          // the same clock ingestion resumes from.
          commitClock: 'committed',
          status: 'pending',
        });
        created.push({
          briefId: briefRow.id,
          organizationId: schedule.organizationId,
        });
      } catch (err) {
        this.logger.error(
          `schedule ${schedule.id} window ${w.start.toISOString()} failed`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    this.logger.log(`schedule ${schedule.id} created=${created.length}`);

    return { briefs: created };
  }

  async claimDue(): Promise<{ briefs: ClaimedBrief[] }> {
    const batchSize = this.envInt(
      'BRIEFS_DISPATCH_BATCH_SIZE',
      DEFAULT_DISPATCH_BATCH_SIZE,
    );

    const dueIds = await this.schedules.findDueIds(batchSize);
    // A full batch is the only signal that the per-tick ceiling is binding:
    // the rest of the due schedules wait for the next tick.
    if (dueIds.length >= batchSize) {
      this.logger.warn(
        `dispatch batch full at ${batchSize}; more schedules may be due (raise BRIEFS_DISPATCH_BATCH_SIZE)`,
      );
    }

    const claimed: ClaimedBrief[] = [];
    for (const scheduleId of dueIds) {
      claimed.push(...(await this.claimSchedule(scheduleId)));
    }

    const reaped = await this.reapStalePending(batchSize);

    this.logger.log(`claimed=${claimed.length} reaped=${reaped.length}`);

    return { briefs: [...claimed, ...reaped] };
  }

  /**
   * Claims one due schedule in its OWN transaction. A Postgres error aborts the
   * whole transaction it happens in, so sharing one transaction across every due
   * schedule meant a single bad row silently rolled back all of them (every
   * later statement failing with 25P02, swallowed, then COMMIT answered with
   * ROLLBACK) while the activity still reported the briefs as claimed. One
   * transaction per schedule makes one bad row cost exactly one schedule.
   */
  private async claimSchedule(scheduleId: string): Promise<ClaimedBrief[]> {
    try {
      return await this.db.transaction().execute(async (tx) => {
        // Re-lock: between the phase-1 read and here another dispatcher may
        // have claimed it (or an admin paused/deleted it).
        const schedule = await this.schedules.findDueByIdForUpdate(
          scheduleId,
          tx,
        );
        if (!schedule) return [];
        return this.claimPeriods(schedule, tx);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        this.logger.log(
          `schedule ${scheduleId} already has a brief for this period; skipping`,
        );
        return [];
      }
      await this.recordDispatchFailure(scheduleId, err);
      return [];
    }
  }

  private async claimPeriods(
    schedule: BriefScheduleSelect,
    tx: AppDatabase,
  ): Promise<ClaimedBrief[]> {
    const now = new Date();

    // Walk every period the schedule should have fired for, not just the one
    // its next_run_at names: after an outage all the intervening periods are
    // still owed a brief.
    const windows: PeriodWindow[] = [];
    let firingAt = schedule.nextRunAt;
    while (
      firingAt.getTime() <= now.getTime() &&
      windows.length < MAX_CATCHUP_PERIODS
    ) {
      windows.push(this.cadence.computePeriod(schedule, firingAt));
      firingAt = this.cadence.computeNextRunAt(schedule, firingAt);
    }
    if (windows.length === 0) return [];

    const caughtUp = firingAt.getTime() > now.getTime();
    if (windows.length > 1) {
      this.logger.warn(
        `schedule ${schedule.id} catching up ${windows.length} missed periods (delivery only for the latest${caughtUp ? '' : '; capped, continues next tick'})`,
      );
    }

    const existing = await this.briefs.findPeriodStartsForSchedule(
      schedule.id,
      windows[0].start,
      tx,
    );

    const claimed: ClaimedBrief[] = [];
    for (const [index, period] of windows.entries()) {
      if (existing.has(period.start.getTime())) continue;
      const briefRow = await this.briefs.create(
        {
          organizationId: schedule.organizationId,
          briefScheduleId: schedule.id,
          scopeType: schedule.scopeType,
          scopeProjectId: schedule.scopeProjectId,
          scopeTeamId: schedule.scopeTeamId,
          scopeCollaboratorId: schedule.scopeCollaboratorId,
          scopeRepositoryId: schedule.scopeRepositoryId,
          scopeBranch: schedule.scopeBranch,
          periodStart: period.start,
          periodEnd: period.end,
          // Snapshot, not a lookup: `computePeriod` cut these boundaries in the
          // schedule's zone as it stands now, and that zone is editable.
          periodTimezone: schedule.timezone,
          // A brief covers what landed on the tracked branch in the period —
          // the same clock ingestion resumes from.
          commitClock: 'committed',
          status: 'pending',
        },
        tx,
      );
      claimed.push({
        briefId: briefRow.id,
        organizationId: schedule.organizationId,
        // Only the most recent complete period is delivered — replaying a week
        // of missed periods must not email every one of them. The others get
        // backfill semantics (generated, visible in the dashboard, not sent).
        deliver: caughtUp && index === windows.length - 1,
      });
    }

    await this.schedules.update(
      schedule.id,
      {
        nextRunAt: firingAt,
        dispatchFailureCount: 0,
        dispatchFailureReason: null,
      },
      tx,
    );

    return claimed;
  }

  private async recordDispatchFailure(
    scheduleId: string,
    err: unknown,
  ): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.error(
      `schedule ${scheduleId} dispatch failed`,
      err instanceof Error ? err.stack : reason,
    );
    try {
      // Its own statement, outside the claim transaction: that one has rolled
      // back, so anything written inside it is gone.
      const row = await this.schedules.recordDispatchFailure(
        scheduleId,
        reason,
        MAX_DISPATCH_FAILURES,
      );
      if (row?.paused) {
        this.logger.warn(
          `schedule ${scheduleId} paused after ${row.dispatchFailureCount} failed dispatches`,
        );
      }
    } catch (bookkeepingErr) {
      this.logger.error(
        `schedule ${scheduleId} failure bookkeeping failed`,
        bookkeepingErr instanceof Error
          ? bookkeepingErr.stack
          : String(bookkeepingErr),
      );
    }
  }

  private async reapStalePending(limit: number): Promise<ClaimedBrief[]> {
    const minutes = this.envInt(
      'BRIEFS_PENDING_REAP_MINUTES',
      DEFAULT_PENDING_REAP_MINUTES,
    );
    const rows = await this.briefs.findStalePending(
      new Date(Date.now() - minutes * 60_000),
      limit,
    );
    if (rows.length > 0) {
      this.logger.warn(
        `re-dispatching ${rows.length} briefs stuck pending for over ${minutes}m`,
      );
    }
    // deliver: false — a pending brief's delivery intent lives only in the
    // workflow argument, and backfill/on-demand briefs share this pool, so
    // delivering them all would be an email storm. Generating unsticks them.
    return rows.map((r) => ({
      briefId: r.id,
      organizationId: r.organizationId,
      deliver: false,
    }));
  }

  private envInt(key: string, fallback: number): number {
    const parsed = Number.parseInt(this.env.get<string>(key) ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private scopeFromBrief(brief: {
    scopeType: 'project' | 'team' | 'collaborator' | 'repository';
    scopeProjectId: string | null;
    scopeTeamId: string | null;
    scopeCollaboratorId: string | null;
    scopeRepositoryId: string | null;
    scopeBranch: string | null;
  }): BriefScope {
    if (brief.scopeType === 'project')
      return { type: 'project', projectId: brief.scopeProjectId! };
    if (brief.scopeType === 'team')
      return { type: 'team', teamId: brief.scopeTeamId! };
    if (brief.scopeType === 'collaborator')
      return {
        type: 'collaborator',
        collaboratorId: brief.scopeCollaboratorId!,
      };
    return {
      type: 'repository',
      repositoryId: brief.scopeRepositoryId!,
      ...(brief.scopeBranch ? { branch: brief.scopeBranch } : {}),
    };
  }

  private scopeFromSchedule(schedule: BriefScheduleSelect): BriefScope {
    if (schedule.scopeType === 'project')
      return { type: 'project', projectId: schedule.scopeProjectId! };
    if (schedule.scopeType === 'team')
      return { type: 'team', teamId: schedule.scopeTeamId! };
    if (schedule.scopeType === 'collaborator')
      return {
        type: 'collaborator',
        collaboratorId: schedule.scopeCollaboratorId!,
      };
    return {
      type: 'repository',
      repositoryId: schedule.scopeRepositoryId!,
      ...(schedule.scopeBranch ? { branch: schedule.scopeBranch } : {}),
    };
  }
}
