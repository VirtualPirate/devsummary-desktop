import type { ConfigService } from '@nestjs/config';
import type { AppDatabase } from '../../../databases/kysely';
import type { BriefsConfig } from '../../briefs-config';
import type { BriefDelivererService } from '../../delivery/services/brief-deliverer.service';
import type { BriefSchedulesRepository } from '../../schedules/repositories/brief-schedules.repository';
import type { CadenceService } from '../../schedules/services/cadence.service';
import type { BriefCommitsRepository } from '../repositories/brief-commits.repository';
import type { BriefsRepository } from '../repositories/briefs.repository';
import type { BriefGeneratorService } from '../services/brief-generator.service';
import type { BriefScopeResolver } from '../services/brief-scope.resolver';
import type { CommitsRepository } from '../../../integrations/github/commit-analysis/repositories/commits.repository';
import { BriefActivities } from './brief.activities';

function makeMocks() {
  return {
    briefs: {
      findById: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      findPeriodStartsForSchedule: jest.fn(),
      findStalePending: jest.fn().mockResolvedValue([]),
    },
    briefCommits: {
      replaceForBrief: jest.fn(),
    },
    generator: {
      generate: jest.fn(),
    },
    deliverer: {
      deliver: jest.fn(),
    },
    cadence: {
      formatPeriodLabel: jest.fn(),
      computePeriod: jest.fn(),
      computeNextRunAt: jest.fn(),
      backfillLookbackStart: jest.fn(),
      lookbackStartFromMonths: jest.fn(),
      windowContaining: jest.fn(),
      windowsInRange: jest.fn(),
    },
    schedules: {
      findById: jest.fn(),
      findDueIds: jest.fn().mockResolvedValue([]),
      findDueByIdForUpdate: jest.fn(),
      recordDispatchFailure: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    commits: {
      findOldestCommitTimestampForScope: jest.fn(),
      findNewestCommitTimestampForScope: jest.fn(),
    },
    scopeResolver: {
      resolve: jest.fn(),
    },
    db: {
      transaction: jest.fn(),
    },
    config: {
      backfillMaxBriefs: 100,
    } as BriefsConfig,
    env: { get: jest.fn().mockReturnValue(undefined) },
  };
}

function makeActivities(
  mocks: ReturnType<typeof makeMocks>,
  config: BriefsConfig | null = mocks.config,
) {
  return new BriefActivities(
    mocks.briefs as unknown as BriefsRepository,
    mocks.briefCommits as unknown as BriefCommitsRepository,
    mocks.generator as unknown as BriefGeneratorService,
    mocks.deliverer as unknown as BriefDelivererService,
    mocks.cadence as unknown as CadenceService,
    mocks.schedules as unknown as BriefSchedulesRepository,
    mocks.commits as unknown as CommitsRepository,
    mocks.scopeResolver as unknown as BriefScopeResolver,
    mocks.db as unknown as AppDatabase,
    config,
    mocks.env as unknown as ConfigService,
  );
}

describe('BriefActivities', () => {
  describe('markGenerating', () => {
    // Regression: a crash between `generateContent`'s write and `deliver` left
    // the brief `generated` with the job row still alive. Exiting here made the
    // handler "succeed", deleted the row, and dropped the delivery for good —
    // an on-demand brief has no schedule to re-fire and nothing re-dispatches a
    // `generated` one. It resumes at delivery instead, with the status left
    // alone so a channel-less brief is not wedged in `generating`.
    it('resumes an already-generated brief at delivery without touching its status', async () => {
      const mocks = makeMocks();
      mocks.briefs.findById.mockResolvedValueOnce({
        id: 'b1',
        status: 'generated',
      });
      const activities = makeActivities(mocks);

      const result = await activities.markGenerating({ briefId: 'b1' });

      expect(result).toEqual({ proceed: true, alreadyGenerated: true });
      expect(mocks.briefs.update).not.toHaveBeenCalled();
    });

    it('returns proceed:false and does not update when the brief is already delivered', async () => {
      const mocks = makeMocks();
      mocks.briefs.findById.mockResolvedValueOnce({
        id: 'b1',
        status: 'delivered',
      });
      const activities = makeActivities(mocks);

      const result = await activities.markGenerating({ briefId: 'b1' });

      expect(result).toEqual({ proceed: false, alreadyGenerated: true });
      expect(mocks.briefs.update).not.toHaveBeenCalled();
    });

    it('marks a pending brief as generating and returns proceed:true', async () => {
      const mocks = makeMocks();
      mocks.briefs.findById.mockResolvedValueOnce({
        id: 'b1',
        status: 'pending',
      });
      const activities = makeActivities(mocks);

      const result = await activities.markGenerating({ briefId: 'b1' });

      expect(mocks.briefs.update).toHaveBeenCalledWith('b1', {
        status: 'generating',
      });
      expect(result).toEqual({ proceed: true, alreadyGenerated: false });
    });

    it('returns proceed:false when the brief is not found', async () => {
      const mocks = makeMocks();
      mocks.briefs.findById.mockResolvedValueOnce(null);
      const activities = makeActivities(mocks);

      const result = await activities.markGenerating({ briefId: 'missing' });

      expect(result).toEqual({ proceed: false, alreadyGenerated: false });
      expect(mocks.briefs.update).not.toHaveBeenCalled();
    });

    // Regression: a crash — or a plain quit — during `generateContent` leaves
    // the brief `generating`. Boot requeues the deduped `brief:<id>` job, and
    // refusing here made the handler "succeed", so the job row was deleted and
    // the brief was wedged forever with no content (`reapStalePending` only
    // ever looks at `pending`).
    it('resumes a brief left generating by a dead process and regenerates its content', async () => {
      const mocks = makeMocks();
      mocks.briefs.findById.mockResolvedValue({
        id: 'b1',
        organizationId: 'o1',
        status: 'generating',
        scopeType: 'repository' as const,
        scopeProjectId: null,
        scopeTeamId: null,
        scopeCollaboratorId: null,
        scopeRepositoryId: 'r1',
        scopeBranch: null,
        periodStart: new Date('2026-01-01T00:00:00Z'),
        periodEnd: new Date('2026-01-02T00:00:00Z'),
        periodTimezone: 'UTC',
        commitClock: 'committed' as const,
      });
      mocks.generator.generate.mockResolvedValueOnce({
        kind: 'empty',
        scopeLabel: 'Repository: acme/widgets',
        contributorCount: 0,
        commitCount: 0,
      });
      mocks.cadence.formatPeriodLabel.mockReturnValueOnce('Jan 1, 2026');
      const activities = makeActivities(mocks);

      expect(await activities.markGenerating({ briefId: 'b1' })).toEqual({
        proceed: true,
        alreadyGenerated: false,
      });
      await activities.generateContent({ briefId: 'b1' });

      expect(mocks.briefs.update).toHaveBeenLastCalledWith(
        'b1',
        expect.objectContaining({ status: 'generated' }),
      );
    });
  });

  describe('generateContent', () => {
    const baseBrief = {
      id: 'b1',
      organizationId: 'o1',
      scopeType: 'repository' as const,
      scopeProjectId: null,
      scopeTeamId: null,
      scopeCollaboratorId: null,
      scopeRepositoryId: 'r1',
      periodStart: new Date('2026-01-01T00:00:00Z'),
      periodEnd: new Date('2026-01-02T00:00:00Z'),
      periodTimezone: 'UTC',
      commitClock: 'authored' as const,
    };

    // Regression: the label was formatted with a hardcoded 'UTC' while the
    // boundaries are local midnights in the schedule's zone, so an IST week
    // starting Aug 3 00:00 IST (= Aug 2 18:30 UTC) was stored as "Aug 2 – …".
    it('formats the period label in the brief’s own timezone', async () => {
      const mocks = makeMocks();
      const istBrief = {
        ...baseBrief,
        periodTimezone: 'Asia/Kolkata',
        periodStart: new Date('2026-08-02T18:30:00Z'),
        periodEnd: new Date('2026-08-09T18:29:59.999Z'),
      };
      mocks.briefs.findById.mockResolvedValueOnce(istBrief);
      mocks.generator.generate.mockResolvedValueOnce({
        kind: 'empty',
        scopeLabel: 'Repository: acme/widgets',
        contributorCount: 0,
        commitCount: 0,
      });
      // The real CadenceService is not under test here; assert the zone it was
      // handed, and that the generator got the same one for the prompt.
      mocks.cadence.formatPeriodLabel.mockReturnValueOnce(
        'Aug 3 – Aug 9, 2026',
      );
      const activities = makeActivities(mocks);

      await activities.generateContent({ briefId: 'b1' });

      expect(mocks.cadence.formatPeriodLabel).toHaveBeenCalledWith(
        { start: istBrief.periodStart, end: istBrief.periodEnd },
        'Asia/Kolkata',
      );
      expect(mocks.generator.generate).toHaveBeenCalledWith(
        expect.objectContaining({ timezone: 'Asia/Kolkata' }),
      );
      // Same rule for the clock as for the zone: it comes off the brief, so a
      // pre-switch brief re-generates the set it originally reported.
      expect(mocks.generator.generate).toHaveBeenCalledWith(
        expect.objectContaining({ commitClock: 'authored' }),
      );
      expect(mocks.briefs.update).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          briefInfoTitle: 'Aug 3 – Aug 9, 2026 · 0 contributors · 0 commits',
        }),
      );
    });

    it('records a no-activity brief and clears brief_commits on an empty result', async () => {
      const mocks = makeMocks();
      mocks.briefs.findById.mockResolvedValueOnce(baseBrief);
      mocks.generator.generate.mockResolvedValueOnce({
        kind: 'empty',
        scopeLabel: 'Repository: acme/widgets',
        contributorCount: 0,
        commitCount: 0,
      });
      mocks.cadence.formatPeriodLabel.mockReturnValueOnce(
        'Jan 1 – Jan 2, 2026',
      );
      const activities = makeActivities(mocks);

      const result = await activities.generateContent({ briefId: 'b1' });

      expect(mocks.briefs.update).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({
          status: 'generated',
          title: 'Repository: acme/widgets — no activity',
          briefInfoTitle: 'Jan 1 – Jan 2, 2026 · 0 contributors · 0 commits',
          summary: 'No activity in this period.',
          contributorCount: 0,
          commitCount: 0,
        }),
      );
      const [, patch] = mocks.briefs.update.mock.calls[0] as [
        string,
        { generatedAt: unknown },
      ];
      expect(patch.generatedAt).toBeInstanceOf(Date);
      expect(mocks.briefCommits.replaceForBrief).toHaveBeenCalledWith('b1', []);
      expect(result).toEqual({ terminal: false });
    });

    it('marks the brief failed and returns terminal:true on SCOPE_DELETED', async () => {
      const mocks = makeMocks();
      mocks.briefs.findById.mockResolvedValueOnce(baseBrief);
      mocks.generator.generate.mockRejectedValueOnce(
        new Error('SCOPE_DELETED: repository missing'),
      );
      const activities = makeActivities(mocks);

      const result = await activities.generateContent({ briefId: 'b1' });

      expect(mocks.briefs.update).toHaveBeenCalledWith('b1', {
        status: 'failed',
        failureReason: 'SCOPE_DELETED: repository missing',
      });
      expect(result).toEqual({ terminal: true });
    });

    it('marks the brief failed and re-throws on a retryable error', async () => {
      const mocks = makeMocks();
      mocks.briefs.findById.mockResolvedValueOnce(baseBrief);
      mocks.generator.generate.mockRejectedValueOnce(new Error('boom'));
      const activities = makeActivities(mocks);

      await expect(
        activities.generateContent({ briefId: 'b1' }),
      ).rejects.toThrow('boom');

      expect(mocks.briefs.update).toHaveBeenCalledWith('b1', {
        status: 'failed',
        failureReason: 'boom',
      });
    });

    it('returns terminal:true without generating when the brief is not found', async () => {
      const mocks = makeMocks();
      mocks.briefs.findById.mockResolvedValueOnce(null);
      const activities = makeActivities(mocks);

      const result = await activities.generateContent({ briefId: 'missing' });

      expect(mocks.generator.generate).not.toHaveBeenCalled();
      expect(result).toEqual({ terminal: true });
    });
  });

  describe('deliver', () => {
    it('delegates to BriefDelivererService', async () => {
      const mocks = makeMocks();
      const activities = makeActivities(mocks);

      await activities.deliver({ briefId: 'b1' });

      expect(mocks.deliverer.deliver).toHaveBeenCalledWith('b1');
    });
  });

  describe('claimDue', () => {
    const fakeTx = { fake: 'tx' };

    function dueSchedule(id: string, nextRunAt: Date) {
      return {
        id,
        organizationId: `org-${id}`,
        nextRunAt,
        // Non-UTC on purpose: the brief must snapshot this, not fall back to UTC
        // and not be re-read off the schedule later (it is editable).
        timezone: 'Asia/Kolkata',
        cadenceType: 'daily' as const,
        scopeType: 'repository' as const,
        scopeProjectId: null,
        scopeTeamId: null,
        scopeCollaboratorId: null,
        scopeRepositoryId: `repo-${id}`,
      };
    }

    // Every claim runs in its own transaction, so each db.transaction() call
    // hands the callback the same fake tx and surfaces its rejection.
    function wireTransactions(mocks: ReturnType<typeof makeMocks>) {
      mocks.db.transaction.mockReturnValue({
        execute: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx),
      });
    }

    // One period due, nothing missed: computePeriod -> the owed window,
    // computeNextRunAt -> an instant in the future, ending the catch-up loop.
    function wireSinglePeriod(
      mocks: ReturnType<typeof makeMocks>,
      period: { start: Date; end: Date },
      nextRunAt: Date,
    ) {
      mocks.cadence.computePeriod.mockReturnValue(period);
      mocks.cadence.computeNextRunAt.mockReturnValue(nextRunAt);
      mocks.briefs.findPeriodStartsForSchedule.mockResolvedValue(new Set());
    }

    it('creates a pending brief for a due schedule, advances nextRunAt, and delivers it', async () => {
      const mocks = makeMocks();
      wireTransactions(mocks);
      mocks.schedules.findDueIds.mockResolvedValueOnce(['s1']);
      mocks.schedules.findDueByIdForUpdate.mockResolvedValueOnce(
        dueSchedule('s1', new Date('2024-01-01')),
      );
      const period = {
        start: new Date('2023-12-31'),
        end: new Date('2024-01-01T00:00:00Z'),
      };
      const nextRunAt = new Date('2999-01-02');
      wireSinglePeriod(mocks, period, nextRunAt);
      mocks.briefs.create.mockResolvedValueOnce({ id: 'b1' });
      const activities = makeActivities(mocks);

      const result = await activities.claimDue();

      expect(mocks.briefs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-s1',
          briefScheduleId: 's1',
          scopeType: 'repository',
          scopeRepositoryId: 'repo-s1',
          periodStart: period.start,
          periodEnd: period.end,
          periodTimezone: 'Asia/Kolkata',
          commitClock: 'landed',
          status: 'pending',
        }),
        fakeTx,
      );
      expect(mocks.schedules.update).toHaveBeenCalledWith(
        's1',
        {
          nextRunAt,
          dispatchFailureCount: 0,
          dispatchFailureReason: null,
        },
        fakeTx,
      );
      expect(result).toEqual({
        briefs: [{ briefId: 'b1', organizationId: 'org-s1', deliver: true }],
      });
    });

    it('returns no briefs when there are no due schedules', async () => {
      const mocks = makeMocks();
      wireTransactions(mocks);
      mocks.schedules.findDueIds.mockResolvedValueOnce([]);
      const activities = makeActivities(mocks);

      const result = await activities.claimDue();

      expect(result).toEqual({ briefs: [] });
      expect(mocks.briefs.create).not.toHaveBeenCalled();
    });

    it('skips a schedule another dispatcher already claimed', async () => {
      const mocks = makeMocks();
      wireTransactions(mocks);
      mocks.schedules.findDueIds.mockResolvedValueOnce(['s1']);
      mocks.schedules.findDueByIdForUpdate.mockResolvedValueOnce(null);
      const activities = makeActivities(mocks);

      const result = await activities.claimDue();

      expect(result).toEqual({ briefs: [] });
      expect(mocks.briefs.create).not.toHaveBeenCalled();
      expect(mocks.schedules.recordDispatchFailure).not.toHaveBeenCalled();
    });

    // Regression: all claims used to share ONE transaction, so a Postgres error
    // on any schedule aborted it and silently rolled back every other insert
    // and nextRunAt advance while still reporting them as claimed.
    it('keeps claiming the other schedules when one of them fails', async () => {
      const mocks = makeMocks();
      wireTransactions(mocks);
      mocks.schedules.findDueIds.mockResolvedValueOnce(['s1', 's2', 's3']);
      mocks.schedules.findDueByIdForUpdate
        .mockResolvedValueOnce(dueSchedule('s1', new Date('2024-01-01')))
        .mockResolvedValueOnce(dueSchedule('s2', new Date('2024-01-01')))
        .mockResolvedValueOnce(dueSchedule('s3', new Date('2024-01-01')));
      wireSinglePeriod(
        mocks,
        {
          start: new Date('2023-12-31'),
          end: new Date('2024-01-01T00:00:00Z'),
        },
        new Date('2999-01-02'),
      );
      mocks.briefs.create
        .mockResolvedValueOnce({ id: 'b1' })
        .mockRejectedValueOnce(new Error('null value violates not-null'))
        .mockResolvedValueOnce({ id: 'b3' });
      const activities = makeActivities(mocks);

      const result = await activities.claimDue();

      expect(result.briefs.map((b) => b.briefId)).toEqual(['b1', 'b3']);
      expect(mocks.schedules.update).toHaveBeenCalledTimes(2);
      expect(mocks.schedules.recordDispatchFailure).toHaveBeenCalledWith(
        's2',
        'null value violates not-null',
        5,
      );
    });

    it('treats a duplicate-period unique violation as already claimed without counting a failure', async () => {
      const mocks = makeMocks();
      wireTransactions(mocks);
      mocks.schedules.findDueIds.mockResolvedValueOnce(['s1']);
      mocks.schedules.findDueByIdForUpdate.mockResolvedValueOnce(
        dueSchedule('s1', new Date('2024-01-01')),
      );
      wireSinglePeriod(
        mocks,
        {
          start: new Date('2023-12-31'),
          end: new Date('2024-01-01T00:00:00Z'),
        },
        new Date('2999-01-02'),
      );
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
      });
      mocks.briefs.create.mockRejectedValueOnce(duplicate);
      const activities = makeActivities(mocks);

      const result = await activities.claimDue();

      expect(result).toEqual({ briefs: [] });
      expect(mocks.schedules.recordDispatchFailure).not.toHaveBeenCalled();
    });

    it('reports a schedule paused once its failures reach the escalation threshold', async () => {
      const mocks = makeMocks();
      wireTransactions(mocks);
      mocks.schedules.findDueIds.mockResolvedValueOnce(['s1']);
      mocks.schedules.findDueByIdForUpdate.mockResolvedValueOnce(
        dueSchedule('s1', new Date('2024-01-01')),
      );
      wireSinglePeriod(
        mocks,
        {
          start: new Date('2023-12-31'),
          end: new Date('2024-01-01T00:00:00Z'),
        },
        new Date('2999-01-02'),
      );
      mocks.briefs.create.mockRejectedValueOnce(new Error('boom'));
      mocks.schedules.recordDispatchFailure.mockResolvedValueOnce({
        id: 's1',
        paused: true,
        dispatchFailureCount: 5,
      });
      const activities = makeActivities(mocks);

      const result = await activities.claimDue();

      expect(result).toEqual({ briefs: [] });
      expect(mocks.schedules.recordDispatchFailure).toHaveBeenCalledWith(
        's1',
        'boom',
        5,
      );
    });

    it('catches up missed periods with delivery only on the most recent one', async () => {
      const mocks = makeMocks();
      wireTransactions(mocks);
      mocks.schedules.findDueIds.mockResolvedValueOnce(['s1']);
      mocks.schedules.findDueByIdForUpdate.mockResolvedValueOnce(
        dueSchedule('s1', new Date('2024-01-01T06:00:00Z')),
      );
      // Three missed daily firings, then a next_run_at in the future.
      mocks.cadence.computePeriod
        .mockReturnValueOnce({
          start: new Date('2023-12-31T00:00:00Z'),
          end: new Date('2024-01-01T00:00:00Z'),
        })
        .mockReturnValueOnce({
          start: new Date('2024-01-01T00:00:00Z'),
          end: new Date('2024-01-02T00:00:00Z'),
        })
        .mockReturnValueOnce({
          start: new Date('2024-01-02T00:00:00Z'),
          end: new Date('2024-01-03T00:00:00Z'),
        });
      mocks.cadence.computeNextRunAt
        .mockReturnValueOnce(new Date('2024-01-02T06:00:00Z'))
        .mockReturnValueOnce(new Date('2024-01-03T06:00:00Z'))
        .mockReturnValueOnce(new Date('2999-01-04T06:00:00Z'));
      mocks.briefs.findPeriodStartsForSchedule.mockResolvedValueOnce(new Set());
      mocks.briefs.create
        .mockResolvedValueOnce({ id: 'b1' })
        .mockResolvedValueOnce({ id: 'b2' })
        .mockResolvedValueOnce({ id: 'b3' });
      const activities = makeActivities(mocks);

      const result = await activities.claimDue();

      expect(result.briefs).toEqual([
        { briefId: 'b1', organizationId: 'org-s1', deliver: false },
        { briefId: 'b2', organizationId: 'org-s1', deliver: false },
        { briefId: 'b3', organizationId: 'org-s1', deliver: true },
      ]);
      expect(mocks.schedules.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          nextRunAt: new Date('2999-01-04T06:00:00Z'),
        }),
        fakeTx,
      );
    });

    it('skips catch-up periods that already have a brief', async () => {
      const mocks = makeMocks();
      wireTransactions(mocks);
      mocks.schedules.findDueIds.mockResolvedValueOnce(['s1']);
      mocks.schedules.findDueByIdForUpdate.mockResolvedValueOnce(
        dueSchedule('s1', new Date('2024-01-01T06:00:00Z')),
      );
      const existingStart = new Date('2023-12-31T00:00:00Z');
      mocks.cadence.computePeriod
        .mockReturnValueOnce({
          start: existingStart,
          end: new Date('2024-01-01T00:00:00Z'),
        })
        .mockReturnValueOnce({
          start: new Date('2024-01-01T00:00:00Z'),
          end: new Date('2024-01-02T00:00:00Z'),
        });
      mocks.cadence.computeNextRunAt
        .mockReturnValueOnce(new Date('2024-01-02T06:00:00Z'))
        .mockReturnValueOnce(new Date('2999-01-03T06:00:00Z'));
      mocks.briefs.findPeriodStartsForSchedule.mockResolvedValueOnce(
        new Set([existingStart.getTime()]),
      );
      mocks.briefs.create.mockResolvedValueOnce({ id: 'b2' });
      const activities = makeActivities(mocks);

      const result = await activities.claimDue();

      expect(mocks.briefs.create).toHaveBeenCalledTimes(1);
      expect(result.briefs).toEqual([
        { briefId: 'b2', organizationId: 'org-s1', deliver: true },
      ]);
    });

    it('re-dispatches briefs stuck pending past the reap threshold, without delivering them', async () => {
      const mocks = makeMocks();
      wireTransactions(mocks);
      mocks.schedules.findDueIds.mockResolvedValueOnce([]);
      mocks.briefs.findStalePending.mockResolvedValueOnce([
        { id: 'stale1', organizationId: 'o9' },
      ]);
      const activities = makeActivities(mocks);

      const result = await activities.claimDue();

      expect(result).toEqual({
        briefs: [{ briefId: 'stale1', organizationId: 'o9', deliver: false }],
      });
      const [olderThan, limit] = mocks.briefs.findStalePending.mock
        .calls[0] as [Date, number];
      expect(limit).toBe(100);
      // Default BRIEFS_PENDING_REAP_MINUTES is 15.
      expect(Date.now() - olderThan.getTime()).toBeGreaterThanOrEqual(
        15 * 60_000,
      );
    });

    it('honours BRIEFS_DISPATCH_BATCH_SIZE for the due-schedule batch', async () => {
      const mocks = makeMocks();
      wireTransactions(mocks);
      mocks.env.get.mockImplementation((key: string) =>
        key === 'BRIEFS_DISPATCH_BATCH_SIZE' ? '250' : undefined,
      );
      mocks.schedules.findDueIds.mockResolvedValueOnce([]);
      const activities = makeActivities(mocks);

      await activities.claimDue();

      expect(mocks.schedules.findDueIds).toHaveBeenCalledWith(250);
    });
  });

  describe('planBackfill', () => {
    it('returns no briefs when briefs generation is not configured', async () => {
      const mocks = makeMocks();
      const activities = makeActivities(mocks, null);

      const result = await activities.planBackfill({ scheduleId: 's1' });

      expect(result).toEqual({ briefs: [] });
      expect(mocks.schedules.findById).not.toHaveBeenCalled();
    });

    it('returns no briefs when the schedule is not found', async () => {
      const mocks = makeMocks();
      mocks.schedules.findById.mockResolvedValueOnce(null);
      const activities = makeActivities(mocks);

      const result = await activities.planBackfill({ scheduleId: 'missing' });

      expect(result).toEqual({ briefs: [] });
    });

    it('returns no briefs when there are no commits in range', async () => {
      const mocks = makeMocks();
      const schedule = {
        id: 's1',
        organizationId: 'o1',
        scopeType: 'repository',
        scopeProjectId: null,
        scopeTeamId: null,
        scopeCollaboratorId: null,
        scopeRepositoryId: 'r1',
        nextRunAt: new Date('2026-01-01'),
      };
      mocks.schedules.findById.mockResolvedValueOnce(schedule);
      mocks.scopeResolver.resolve.mockResolvedValueOnce({
        repositoryIds: ['r1'],
        scopeLabel: 'Repository: acme/widgets',
      });
      mocks.cadence.backfillLookbackStart.mockReturnValueOnce(
        new Date('2025-01-01'),
      );
      mocks.cadence.computePeriod.mockReturnValueOnce({
        start: new Date('2026-01-01'),
        end: new Date('2026-01-02'),
      });
      mocks.commits.findOldestCommitTimestampForScope.mockResolvedValueOnce(
        null,
      );
      const activities = makeActivities(mocks);

      const result = await activities.planBackfill({ scheduleId: 's1' });

      expect(result).toEqual({ briefs: [] });
      expect(
        mocks.commits.findNewestCommitTimestampForScope,
      ).not.toHaveBeenCalled();
    });

    it('derives the lookback from backfillMonths when the caller sets it', async () => {
      // Pinned so the MAX_HISTORY_DAYS clamp below leaves the mocked start
      // alone — three months back from here is inside the 90-day ceiling.
      jest.useFakeTimers().setSystemTime(new Date('2025-11-01T00:00:00Z'));
      const mocks = makeMocks();
      mocks.schedules.findById.mockResolvedValueOnce({
        id: 's1',
        organizationId: 'o1',
        scopeType: 'repository',
        scopeProjectId: null,
        scopeTeamId: null,
        scopeCollaboratorId: null,
        scopeRepositoryId: 'r1',
        nextRunAt: new Date('2026-01-01'),
      });
      mocks.scopeResolver.resolve.mockResolvedValueOnce({
        repositoryIds: ['r1'],
        scopeLabel: 'Repository: acme/widgets',
      });
      mocks.cadence.lookbackStartFromMonths.mockReturnValueOnce(
        new Date('2025-10-01'),
      );
      mocks.cadence.computePeriod.mockReturnValueOnce({
        start: new Date('2026-01-01'),
        end: new Date('2026-01-02'),
      });
      mocks.commits.findOldestCommitTimestampForScope.mockResolvedValueOnce(
        null,
      );
      const activities = makeActivities(mocks);

      await activities.planBackfill({ scheduleId: 's1', backfillMonths: 3 });

      expect(mocks.cadence.lookbackStartFromMonths).toHaveBeenCalledWith(
        expect.any(Date),
        3,
      );
      expect(mocks.cadence.backfillLookbackStart).not.toHaveBeenCalled();
      expect(
        mocks.commits.findOldestCommitTimestampForScope,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ since: new Date('2025-10-01') }),
      );
      jest.useRealTimers();
    });

    // MAX_HISTORY_DAYS is the product ceiling on history, and both lookback
    // branches converge on one clamp. Unclamped, the legacy branch reaches back
    // `backfillMaxBriefs` *cadence units* — 100 weeks for a weekly schedule —
    // and bills an OpenAI call for every window of it.
    it.each([
      ['legacy cadence-unit lookback', undefined, 'backfillLookbackStart'],
      ['an explicit backfillMonths', 3, 'lookbackStartFromMonths'],
    ] as const)(
      'clamps %s to the 90-day ceiling',
      async (_label, backfillMonths, mockName) => {
        jest.useFakeTimers().setSystemTime(new Date('2026-05-16T12:00:00Z'));
        const mocks = makeMocks();
        mocks.schedules.findById.mockResolvedValueOnce({
          id: 's1',
          organizationId: 'o1',
          scopeType: 'repository',
          scopeProjectId: null,
          scopeTeamId: null,
          scopeCollaboratorId: null,
          scopeRepositoryId: 'r1',
          nextRunAt: new Date('2026-05-17'),
        });
        mocks.scopeResolver.resolve.mockResolvedValueOnce({
          repositoryIds: ['r1'],
          scopeLabel: 'Repository: acme/widgets',
        });
        mocks.cadence[mockName].mockReturnValueOnce(new Date('2020-01-01'));
        mocks.cadence.computePeriod.mockReturnValueOnce({
          start: new Date('2026-05-17'),
          end: new Date('2026-05-18'),
        });
        mocks.commits.findOldestCommitTimestampForScope.mockResolvedValueOnce(
          null,
        );
        const activities = makeActivities(mocks);

        await activities.planBackfill({ scheduleId: 's1', backfillMonths });

        expect(
          mocks.commits.findOldestCommitTimestampForScope,
        ).toHaveBeenCalledWith(
          // 90 days before the pinned now, not 2020.
          expect.objectContaining({ since: new Date('2026-02-15T12:00:00Z') }),
        );
        jest.useRealTimers();
      },
    );

    it('creates a pending brief per backfill window and returns their ids', async () => {
      const mocks = makeMocks();
      const schedule = {
        id: 's1',
        organizationId: 'o1',
        scopeType: 'repository',
        scopeProjectId: null,
        scopeTeamId: null,
        scopeCollaboratorId: null,
        scopeRepositoryId: 'r1',
        timezone: 'Asia/Kolkata',
        nextRunAt: new Date('2026-01-08T00:00:00Z'),
      };
      mocks.schedules.findById.mockResolvedValueOnce(schedule);
      mocks.scopeResolver.resolve.mockResolvedValueOnce({
        repositoryIds: ['r1'],
        scopeLabel: 'Repository: acme/widgets',
      });
      mocks.cadence.backfillLookbackStart.mockReturnValueOnce(
        new Date('2025-01-01'),
      );
      mocks.cadence.computePeriod.mockReturnValueOnce({
        start: new Date('2026-01-07T00:00:00Z'),
        end: new Date('2026-01-08T00:00:00Z'),
      });
      const oldest = new Date('2026-01-01T12:00:00Z');
      const newest = new Date('2026-01-03T12:00:00Z');
      mocks.commits.findOldestCommitTimestampForScope.mockResolvedValueOnce(
        oldest,
      );
      mocks.commits.findNewestCommitTimestampForScope.mockResolvedValueOnce(
        newest,
      );
      mocks.cadence.windowContaining
        .mockReturnValueOnce({
          start: new Date('2026-01-01T00:00:00Z'),
          end: new Date('2026-01-02T00:00:00.000Z'),
        })
        .mockReturnValueOnce({
          start: new Date('2026-01-03T00:00:00Z'),
          end: new Date('2026-01-04T00:00:00.000Z'),
        });
      mocks.briefs.findPeriodStartsForSchedule.mockResolvedValueOnce(new Set());
      const windowJan2 = {
        start: new Date('2026-01-02T00:00:00Z'),
        end: new Date('2026-01-03T00:00:00.000Z'),
      };
      const windowJan1 = {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2026-01-02T00:00:00.000Z'),
      };
      mocks.cadence.windowsInRange.mockReturnValueOnce([
        windowJan2,
        windowJan1,
      ]);
      mocks.briefs.create
        .mockResolvedValueOnce({ id: 'brief-jan2' })
        .mockResolvedValueOnce({ id: 'brief-jan1' });
      const activities = makeActivities(mocks);

      const result = await activities.planBackfill({ scheduleId: 's1' });

      // The newest window's own `end` is already the exclusive upper bound —
      // adding a millisecond to it (as the pre-half-open code did) reaches into
      // the window after it and backfills a trailing empty period.
      expect(mocks.cadence.windowsInRange).toHaveBeenCalledWith(
        schedule,
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-04T00:00:00.000Z'),
      );
      expect(mocks.briefs.create).toHaveBeenCalledTimes(2);
      expect(mocks.briefs.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          organizationId: 'o1',
          briefScheduleId: 's1',
          scopeType: 'repository',
          scopeRepositoryId: 'r1',
          periodStart: windowJan2.start,
          periodEnd: windowJan2.end,
          periodTimezone: 'Asia/Kolkata',
          commitClock: 'landed',
          status: 'pending',
        }),
      );
      expect(mocks.briefs.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          periodStart: windowJan1.start,
          periodEnd: windowJan1.end,
        }),
      );
      expect(result).toEqual({
        briefs: [
          { briefId: 'brief-jan2', organizationId: 'o1' },
          { briefId: 'brief-jan1', organizationId: 'o1' },
        ],
      });
    });
  });
});
