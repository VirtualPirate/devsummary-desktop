import { BriefsService } from '../services/briefs.service';
import type { BriefPreviewQuery } from '@launchstack/api-interfaces';

describe('BriefsService.preview', () => {
  const PERIOD = {
    periodStart: '2026-08-07T00:00:00.000Z',
    periodEnd: '2026-08-14T00:00:00.000Z',
  };
  const QUERY: BriefPreviewQuery = {
    scopeType: 'project',
    scopeProjectId: '11111111-1111-4111-8111-111111111111',
    ...PERIOD,
  };

  function makeService(over: {
    totals?: { commits: number; contributors: number; repositories: number };
    typeRows?: Array<{ commitType: string | null; commits: number }>;
    bounds?: { earliest: Date | null; latest: Date | null };
    recent?: unknown;
    resolved?: Record<string, unknown>;
  }) {
    const findMostRecentForScope = jest
      .fn()
      .mockResolvedValue(over.recent ?? null);
    const report = {
      previewTotals: jest
        .fn()
        .mockResolvedValue(
          over.totals ?? { commits: 0, contributors: 0, repositories: 0 },
        ),
      previewTypeBuckets: jest.fn().mockResolvedValue(over.typeRows ?? []),
      scopeBounds: jest
        .fn()
        .mockResolvedValue(over.bounds ?? { earliest: null, latest: null }),
    };
    const scopes = {
      resolve: jest.fn().mockResolvedValue(
        over.resolved ?? {
          repositoryIds: ['r1'],
          scopeLabel: 'Project: Platform',
        },
      ),
    };
    // ctor: (briefs, briefCommits, projects, teams, collaborators, repos,
    //        trackedBranches, slack, temporal, scopes, report)
    const service = new BriefsService(
      { findMostRecentForScope } as never,
      null as never,
      {
        findByIdScopedToOrg: jest.fn().mockResolvedValue({ id: 'p1' }),
      } as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      scopes as never,
      report as never,
      null as never,
    );
    return { service, report, scopes, findMostRecentForScope };
  }

  it('folds type buckets into full counts and derives analyzed', async () => {
    const { service } = makeService({
      totals: { commits: 10, contributors: 3, repositories: 2 },
      typeRows: [
        { commitType: 'feature', commits: 4 },
        { commitType: 'fix', commits: 3 },
        { commitType: null, commits: 3 },
      ],
    });

    const res = await service.preview('org1', QUERY);

    expect(res.commits).toBe(10);
    expect(res.contributors).toBe(3);
    expect(res.repositories).toBe(2);
    // Only the rows carrying a type are analysed; the null row is not.
    expect(res.analyzed).toBe(7);
    expect(res.commitTypeCounts.feature).toBe(4);
    expect(res.commitTypeCounts.fix).toBe(3);
    expect(res.commitTypeCounts.unclassified).toBe(3);
    // Every key present, zeros included — the chart reads them all.
    expect(res.commitTypeCounts.docs).toBe(0);
  });

  it('files an unknown commit_type under unclassified without losing it', async () => {
    const { service } = makeService({
      totals: { commits: 2, contributors: 1, repositories: 1 },
      typeRows: [{ commitType: 'security', commits: 2 }],
    });

    const res = await service.preview('org1', QUERY);

    expect(res.commitTypeCounts.unclassified).toBe(2);
    const summed = Object.values(res.commitTypeCounts).reduce(
      (a, b) => a + b,
      0,
    );
    expect(summed).toBe(res.commits);
  });

  it('counts the window through the resolved scope, bounds ignoring it', async () => {
    const { service, report } = makeService({
      resolved: {
        repositoryIds: ['r1', 'r2'],
        scopeLabel: 'Team: Payments',
        authorFilter: [7n],
        branchFilter: undefined,
      },
    });

    await service.preview('org1', QUERY);

    expect(report.previewTotals).toHaveBeenCalledWith({
      repositoryIds: ['r1', 'r2'],
      authorFilter: [7n],
      branchFilter: undefined,
      // No brief row exists yet; the preview is of the brief Generate would
      // create, and that one is written on the committer clock.
      commitClock: 'committed',
      from: new Date(PERIOD.periodStart),
      to: new Date(PERIOD.periodEnd),
    });
    // scopeBounds answers "what history exists at all", so it must carry no
    // dates — an exact match is what proves they are absent.
    expect(report.scopeBounds).toHaveBeenCalledWith({
      repositoryIds: ['r1', 'r2'],
      authorFilter: [7n],
      branchFilter: undefined,
      commitClock: 'committed',
    });
  });

  it('surfaces a recent brief for the same scope', async () => {
    const created = new Date('2026-08-14T09:00:00.000Z');
    const { service, findMostRecentForScope } = makeService({
      recent: {
        id: 'b1',
        periodStart: new Date('2026-08-07T00:00:00.000Z'),
        periodEnd: new Date('2026-08-14T00:00:00.000Z'),
        // Non-UTC on purpose: the caller formats the period with this, so a
        // dropped passthrough must fail here rather than read a day early.
        periodTimezone: 'Asia/Kolkata',
        createdAt: created,
      },
    });

    const res = await service.preview('org1', QUERY);

    expect(res.recentBrief).toEqual({
      id: 'b1',
      periodStart: '2026-08-07T00:00:00.000Z',
      periodEnd: '2026-08-14T00:00:00.000Z',
      periodTimezone: 'Asia/Kolkata',
      createdAt: created.toISOString(),
    });
    expect(findMostRecentForScope).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        scopeType: 'project',
        scopeProjectId: QUERY.scopeProjectId,
        // The unused scope columns must be null, not undefined: the query
        // matches them with `is null` to pin the scope exactly.
        scopeTeamId: null,
        scopeCollaboratorId: null,
        scopeRepositoryId: null,
      }),
    );
  });

  it('rejects a period that ends at or before it starts', async () => {
    const { service, report } = makeService({});

    await expect(
      service.preview('org1', {
        ...QUERY,
        periodStart: '2026-08-14T00:00:00.000Z',
        periodEnd: '2026-08-14T00:00:00.000Z',
      }),
    ).rejects.toThrow();
    // Rejected at the boundary — no query ran.
    expect(report.previewTotals).not.toHaveBeenCalled();
  });
});
