import { AnalyticsService } from '../services/analytics.service';

function makeMocks() {
  return {
    activity: { aggregate: jest.fn(async () => []) } as any,
    collaborators: { findByIdScopedToOrg: jest.fn(async () => null) } as any,
  };
}

function makeService(overrides: Partial<ReturnType<typeof makeMocks>> = {}) {
  const m = { ...makeMocks(), ...overrides };
  return {
    service: new AnalyticsService(m.activity, m.collaborators),
    mocks: m,
  };
}

const baseQuery = {
  from: '2026-06-01T00:00:00.000Z',
  to: '2026-06-04T00:00:00.000Z',
  granularity: 'day' as const,
  timezone: 'UTC',
};

function row(bucket: string, overrides: Record<string, number> = {}) {
  return {
    bucket,
    commits: 0,
    additions: 0,
    deletions: 0,
    feature: 0,
    fix: 0,
    optimization: 0,
    refactor: 0,
    docs: 0,
    test: 0,
    chore: 0,
    ...overrides,
  };
}

describe('AnalyticsService.getCommitActivity', () => {
  it('zero-fills buckets with no rows', async () => {
    const { service, mocks } = makeService();
    mocks.activity.aggregate.mockResolvedValueOnce([
      row('2026-06-02', {
        commits: 3,
        feature: 2,
        additions: 50,
        deletions: 5,
      }),
    ]);
    const result = await service.getCommitActivity('org-1', baseQuery);
    expect(result.points.map((p) => p.date)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
    ]);
    expect(result.points[0].commits).toBe(0);
    expect(result.points[1].commits).toBe(3);
    expect(result.points[1].additions).toBe(50);
  });

  it('derives unclassified as commits minus typed counts', async () => {
    const { service, mocks } = makeService();
    mocks.activity.aggregate.mockResolvedValueOnce([
      row('2026-06-01', { commits: 10, feature: 4, fix: 3 }),
    ]);
    const result = await service.getCommitActivity('org-1', baseQuery);
    expect(result.points[0].byType).toEqual({
      feature: 4,
      fix: 3,
      optimization: 0,
      refactor: 0,
      docs: 0,
      test: 0,
      chore: 0,
      unclassified: 3,
    });
  });

  it('echoes the resolved range', async () => {
    const { service } = makeService();
    const result = await service.getCommitActivity('org-1', baseQuery);
    expect(result.range).toEqual({
      from: baseQuery.from,
      to: baseQuery.to,
      granularity: 'day',
      timezone: 'UTC',
    });
  });

  it('resolves the collaborator org-scoped and filters by github user id', async () => {
    const { service, mocks } = makeService();
    mocks.collaborators.findByIdScopedToOrg.mockResolvedValueOnce({
      id: 'col-1',
      githubUserId: 99n,
    });
    await service.getCommitActivity('org-1', {
      ...baseQuery,
      collaboratorId: 'col-1',
    });
    expect(mocks.collaborators.findByIdScopedToOrg).toHaveBeenCalledWith(
      'col-1',
      'org-1',
    );
    expect(mocks.activity.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ authorGithubUserId: 99n }),
    );
  });

  it('throws GITHUB_COLLABORATOR_NOT_FOUND for an unknown collaborator', async () => {
    const { service } = makeService();
    await expect(
      service.getCommitActivity('org-1', {
        ...baseQuery,
        collaboratorId: 'a0000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'GITHUB_COLLABORATOR_NOT_FOUND' });
  });

  it('throws ANALYTICS_RANGE_TOO_LARGE above the bucket limit', async () => {
    const { service } = makeService();
    await expect(
      service.getCommitActivity('org-1', {
        ...baseQuery,
        from: '2020-01-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'ANALYTICS_RANGE_TOO_LARGE' });
  });

  it('passes the repository filter through', async () => {
    const { service, mocks } = makeService();
    await service.getCommitActivity('org-1', {
      ...baseQuery,
      repositoryId: 'repo-1',
    });
    expect(mocks.activity.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: 'repo-1' }),
    );
  });

  it('normalizes CLDR-legacy timezones before querying and echoes the normalized id', async () => {
    const { service, mocks } = makeService();
    const result = await service.getCommitActivity('org-1', {
      ...baseQuery,
      timezone: 'Asia/Calcutta',
    });
    expect(mocks.activity.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Asia/Kolkata' }),
    );
    expect(result.range.timezone).toBe('Asia/Kolkata');
  });
});
