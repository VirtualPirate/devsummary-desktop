import { BriefReportService } from '../brief-report.service';

const BRIEF = {
  id: 'brief1',
  organizationId: 'org1',
  briefScheduleId: null,
  scopeType: 'repository' as const,
  scopeProjectId: null,
  scopeTeamId: null,
  scopeCollaboratorId: null,
  scopeRepositoryId: 'repo1',
  periodStart: new Date('2026-08-02T00:00:00Z'),
  periodEnd: new Date('2026-08-09T00:00:00Z'),
  periodTimezone: 'UTC',
  commitClock: 'committed' as const,
};

function makeService(overrides: {
  brief?: unknown;
  resolve?: jest.Mock;
  daily?: unknown[];
  previous?: { commits: number; additions: number; deletions: number };
  contributors?: unknown[];
  repositories?: unknown[];
}) {
  const briefs = {
    findByIdScopedToOrg: jest
      .fn()
      .mockResolvedValue(
        overrides.brief === undefined ? BRIEF : overrides.brief,
      ),
  };
  const scopeResolver = {
    resolve:
      overrides.resolve ??
      jest.fn().mockResolvedValue({
        repositoryIds: ['repo1'],
        scopeLabel: 'Repository: acme/web',
        authorFilter: undefined,
      }),
  };
  const report = {
    dailyBuckets: jest.fn().mockResolvedValue(overrides.daily ?? []),
    periodTotals: jest
      .fn()
      .mockResolvedValue(
        overrides.previous ?? { commits: 0, additions: 0, deletions: 0 },
      ),
    contributorBuckets: jest
      .fn()
      .mockResolvedValue(overrides.contributors ?? []),
    repositoryTotals: jest.fn().mockResolvedValue(overrides.repositories ?? []),
  };
  const service = new BriefReportService(
    briefs as never,
    scopeResolver as never,
    report as never,
  );
  return { service, briefs, scopeResolver, report };
}

describe('BriefReportService.build', () => {
  it('folds docs, test and chore into a single upkeep total', async () => {
    const day = '2026-08-03';
    const { service } = makeService({
      daily: [
        {
          day,
          commitType: 'docs',
          commits: 2,
          additions: 10,
          deletions: 1,
          withLoc: 2,
        },
        {
          day,
          commitType: 'test',
          commits: 3,
          additions: 20,
          deletions: 2,
          withLoc: 3,
        },
        {
          day,
          commitType: 'chore',
          commits: 1,
          additions: 5,
          deletions: 0,
          withLoc: 1,
        },
        {
          day,
          commitType: 'feature',
          commits: 4,
          additions: 90,
          deletions: 3,
          withLoc: 4,
        },
      ],
    });

    const result = await service.build('org1', 'brief1');

    expect(result.workBreakdown).toEqual([
      { category: 'upkeep', commits: 6 },
      { category: 'feature', commits: 4 },
    ]);
  });

  it('zero-fills every day in the period', async () => {
    const { service } = makeService({
      daily: [
        {
          day: '2026-08-04',
          commitType: 'fix',
          commits: 3,
          additions: 30,
          deletions: 4,
          withLoc: 3,
        },
      ],
    });

    const result = await service.build('org1', 'brief1');

    expect(result.daily).toHaveLength(7);
    expect(result.daily[0].date).toBe('2026-08-02');
    expect(result.daily[0].counts.fix).toBe(0);
    expect(result.daily[2].date).toBe('2026-08-04');
    expect(result.daily[2].counts.fix).toBe(3);
  });

  // An ad-hoc brief runs now-7d → now, so its window is not aligned to
  // midnight and genuinely touches eight calendar days. Every one of them is
  // in range; nothing beyond the last may appear.
  it('covers every calendar day an unaligned period touches, and no more', async () => {
    const { service } = makeService({
      brief: {
        ...BRIEF,
        periodStart: new Date('2026-08-05T14:23:00Z'),
        periodEnd: new Date('2026-08-12T14:23:00Z'),
      },
      daily: [
        {
          day: '2026-08-12',
          commitType: 'feature',
          commits: 4,
          additions: 40,
          deletions: 2,
          withLoc: 4,
        },
      ],
    });

    const result = await service.build('org1', 'brief1');

    expect(result.daily.map((d) => d.date)).toEqual([
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ]);
    expect(result.daily[7].counts.feature).toBe(4);
  });

  // `periodEnd` is exclusive, so the day it names is the first day the brief
  // does NOT cover. A stray bucket on it must not become an eighth column.
  it('never charts a day outside the period', async () => {
    const { service } = makeService({
      daily: [
        {
          day: '2026-08-09',
          commitType: 'feature',
          commits: 1,
          additions: 5,
          deletions: 0,
          withLoc: 1,
        },
      ],
    });

    const result = await service.build('org1', 'brief1');

    expect(result.daily).toHaveLength(7);
    expect(result.daily.at(-1)?.date).toBe('2026-08-08');
  });

  // Half-open all the way down: the day ranges tile the period exactly, and the
  // previous window ends where the current one starts. With the old inclusive
  // end the previous window stopped a millisecond short and the last day's `to`
  // overshot `periodEnd`.
  it('tiles the period with day ranges that meet its own boundaries', async () => {
    const { service, report } = makeService({});

    await service.build('org1', 'brief1');

    const calls = report.dailyBuckets.mock.calls as Array<
      [{ days: Array<{ from: Date; to: Date }> }]
    >;
    const days = calls[0][0].days;
    expect(days[0].from).toEqual(BRIEF.periodStart);
    expect(days.at(-1)?.to).toEqual(BRIEF.periodEnd);
    for (let i = 1; i < days.length; i++) {
      expect(days[i].from.getTime()).toBe(days[i - 1].to.getTime());
    }

    // The previous period is [periodStart - length, periodStart) — exclusive of
    // periodStart, which belongs to the current window.
    expect(report.periodTotals).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date('2026-07-26T00:00:00Z'),
        to: BRIEF.periodStart,
      }),
    );
  });

  /**
   * The clock is snapshotted for the same reason the zone is: the report
   * re-queries live, so a brief generated on the author clock must keep being
   * counted on it, or its own stored `commit_count` stops matching the report
   * printed next to it.
   */
  it.each(['authored', 'committed'] as const)(
    'threads the brief’s own commit clock (%s) into every window query',
    async (commitClock) => {
      const { service, report } = makeService({
        brief: { ...BRIEF, commitClock },
      });

      await service.build('org1', 'brief1');

      for (const q of [
        report.dailyBuckets,
        report.periodTotals,
        report.contributorBuckets,
        report.repositoryTotals,
      ]) {
        expect(q).toHaveBeenCalledWith(
          expect.objectContaining({ commitClock }),
        );
      }
    },
  );

  /**
   * Africa/Cairo springs forward AT midnight on 2026-04-24, so that day has no
   * 00:00. The report used `date-fns-tz`'s `fromZonedTime`, which resolves such
   * a wall clock to the hour *before* the gap — an hour earlier than the
   * boundary `CadenceService` cut the brief's own `periodEnd` at. The last day's
   * range then ended before the period did, dropping that hour of commits out
   * of the final column while the brief's stored total still counted them.
   */
  it('tiles a day whose local midnight does not exist, up to the period end', async () => {
    const periodStart = new Date('2026-04-22T22:00:00Z'); // Apr 23 00:00 EET
    const periodEnd = new Date('2026-04-23T22:00:00Z'); // Apr 24 01:00 EEST
    const { service, report } = makeService({
      brief: {
        ...BRIEF,
        periodTimezone: 'Africa/Cairo',
        periodStart,
        periodEnd,
      },
    });

    await service.build('org1', 'brief1');

    const days = (
      report.dailyBuckets.mock.calls as Array<
        [{ days: Array<{ key: string; from: Date; to: Date }> }]
      >
    )[0][0].days;
    expect(days.map((d) => d.key)).toEqual(['2026-04-23']);
    expect(days[0].from).toEqual(periodStart);
    expect(days[0].to).toEqual(periodEnd);
  });

  // The timezone used to be read off the live `brief_schedules` row, so editing
  // a schedule's timezone re-tiled every brief already generated under the old
  // one: partial first/last columns and a day total that no longer summed to
  // the stored commit_count. The brief carries its own snapshot now — this
  // brief's period is Aug 3 00:00 IST → Aug 10 00:00 IST, which is 7 IST days
  // but touches 8 UTC ones.
  it('tiles the brief’s own timezone, not the schedule’s current one', async () => {
    const { service } = makeService({
      brief: {
        ...BRIEF,
        briefScheduleId: 'sched1',
        periodTimezone: 'Asia/Kolkata',
        periodStart: new Date('2026-08-02T18:30:00Z'),
        periodEnd: new Date('2026-08-09T18:30:00Z'),
      },
      daily: [
        {
          day: '2026-08-03',
          commitType: 'feature',
          commits: 4,
          additions: 40,
          deletions: 2,
          withLoc: 4,
        },
      ],
    });

    const result = await service.build('org1', 'brief1');

    expect(result.timezone).toBe('Asia/Kolkata');
    expect(result.daily.map((d) => d.date)).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ]);
    // Every commit lands inside a charted day, so the columns still sum to the
    // brief's own total — the invariant the schedule lookup used to break.
    expect(result.daily[0].counts.feature).toBe(4);
    expect(result.totals.commits).toBe(4);
  });

  it('counts commits with no usable analysis as unclassified', async () => {
    const { service } = makeService({
      daily: [
        {
          day: '2026-08-03',
          commitType: null,
          commits: 2,
          additions: 0,
          deletions: 0,
          withLoc: 0,
        },
      ],
    });

    const result = await service.build('org1', 'brief1');

    expect(result.totals.commits).toBe(2);
    expect(result.daily[1].counts.unclassified).toBe(2);
    expect(result.workBreakdown).toEqual([]);
    expect(result.locCoverage).toEqual({ withLoc: 0, total: 2 });
  });

  it('returns null deltas when the previous period had no commits', async () => {
    const { service } = makeService({
      daily: [
        {
          day: '2026-08-03',
          commitType: 'feature',
          commits: 5,
          additions: 50,
          deletions: 5,
          withLoc: 5,
        },
      ],
      contributors: [
        {
          window: 0,
          collaboratorId: 'c1',
          login: 'priya',
          name: 'Priya',
          avatarUrl: null,
          collaboratorType: 'User',
          commits: 5,
          repositories: 1,
        },
      ],
    });

    const result = await service.build('org1', 'brief1');

    expect(result.deltas).toEqual({
      commits: null,
      contributors: null,
      linesAdded: null,
      linesRemoved: null,
    });
  });

  it('computes ratio deltas against the previous period', async () => {
    const { service } = makeService({
      daily: [
        {
          day: '2026-08-03',
          commitType: 'feature',
          commits: 13,
          additions: 120,
          deletions: 10,
          withLoc: 13,
        },
      ],
      previous: { commits: 10, additions: 100, deletions: 20 },
      contributors: [
        {
          window: 0,
          collaboratorId: 'c1',
          login: 'priya',
          name: 'Priya',
          avatarUrl: null,
          collaboratorType: 'User',
          commits: 13,
          repositories: 1,
        },
        {
          window: 1,
          collaboratorId: 'c2',
          login: 'marcus',
          name: 'Marcus',
          avatarUrl: null,
          collaboratorType: 'User',
          commits: 10,
          repositories: 1,
        },
      ],
    });

    const result = await service.build('org1', 'brief1');

    expect(result.totals.commits).toBe(13);
    expect(result.deltas.commits).toBeCloseTo(0.3);
    expect(result.deltas.linesAdded).toBeCloseTo(0.2);
    expect(result.deltas.linesRemoved).toBeCloseTo(-0.5);
    expect(result.deltas.contributors).toBe(0);
  });

  it('flags a deleted scope and runs no queries', async () => {
    const { service, report } = makeService({
      resolve: jest
        .fn()
        .mockRejectedValue(new Error('SCOPE_DELETED: project missing')),
    });

    const result = await service.build('org1', 'brief1');

    expect(result.scopeDeleted).toBe(true);
    expect(result.totals.commits).toBe(0);
    expect(report.dailyBuckets).not.toHaveBeenCalled();
  });

  it('flags a scope that resolves to no repositories', async () => {
    const { service, report } = makeService({
      resolve: jest.fn().mockResolvedValue({
        repositoryIds: [],
        scopeLabel: 'Team: Payments',
        authorFilter: [],
      }),
    });

    const result = await service.build('org1', 'brief1');

    expect(result.scopeDeleted).toBe(true);
    expect(report.dailyBuckets).not.toHaveBeenCalled();
  });

  it('marks bot contributors', async () => {
    const { service } = makeService({
      contributors: [
        {
          window: 0,
          collaboratorId: 'c9',
          login: 'dependabot[bot]',
          name: 'dependabot',
          avatarUrl: null,
          collaboratorType: 'Bot',
          commits: 6,
          repositories: 2,
        },
        {
          window: 0,
          collaboratorId: null,
          login: 'renovate[bot]',
          name: 'renovate',
          avatarUrl: null,
          collaboratorType: null,
          commits: 2,
          repositories: 1,
        },
      ],
    });

    const result = await service.build('org1', 'brief1');

    expect(result.contributors[0].isBot).toBe(true);
    expect(result.contributors[1].isBot).toBe(true);
  });
});
