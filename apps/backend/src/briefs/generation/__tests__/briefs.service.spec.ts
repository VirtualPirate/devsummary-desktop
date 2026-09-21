import { BriefsService } from '../services/briefs.service';

describe('BriefsService.list filter mapping', () => {
  function makeService(listMock: jest.Mock) {
    // list() exercises the briefs repository and the type-count aggregation;
    // the other six constructor deps are unused on this path.
    const briefCommits = {
      countTypesForBriefs: jest.fn().mockResolvedValue([]),
    };
    return new BriefsService(
      { list: listMock } as never,
      briefCommits as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null,
    );
  }

  it('maps from/to to Date period bounds and passes excludeNoActivity', async () => {
    const listMock = jest.fn().mockResolvedValue([]);
    const service = makeService(listMock);

    await service.list('org1', {
      from: '2026-06-01T00:00:00.000Z',
      // Exclusive on the wire: the midnight after the last day the user picked.
      to: '2026-06-08T00:00:00.000Z',
      excludeNoActivity: true,
      limit: 20,
    });

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        periodEndFrom: new Date('2026-06-01T00:00:00.000Z'),
        periodEndTo: new Date('2026-06-08T00:00:00.000Z'),
        excludeNoActivity: true,
      }),
    );
  });

  it('leaves period bounds undefined when from/to absent', async () => {
    const listMock = jest.fn().mockResolvedValue([]);
    const service = makeService(listMock);

    await service.list('org1', { limit: 20 });

    const arg = listMock.mock.calls[0][0];
    expect(arg.periodEndFrom).toBeUndefined();
    expect(arg.periodEndTo).toBeUndefined();
  });
});

describe('BriefsService.getCommits', () => {
  function makeService(deps: {
    findByIdScopedToOrg: jest.Mock;
    listForBrief?: jest.Mock;
    listContributorsForBrief?: jest.Mock;
  }) {
    const briefs = {
      findByIdScopedToOrg: deps.findByIdScopedToOrg,
    };
    const briefCommits = {
      listForBrief: deps.listForBrief ?? jest.fn().mockResolvedValue([]),
      listContributorsForBrief:
        deps.listContributorsForBrief ?? jest.fn().mockResolvedValue([]),
    };
    // ctor: (briefs, briefCommits, projects, teams, collaborators, repos,
    //        trackedBranches, queue, scopes, report, deliverer, ingestStatus)
    return new BriefsService(
      briefs as never,
      briefCommits as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
  }

  it('throws BRIEF_NOT_FOUND when the brief is not in the org', async () => {
    const service = makeService({
      findByIdScopedToOrg: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.getCommits('org1', 'b1', { limit: 50 }),
    ).rejects.toBeDefined();
  });

  it('passes the contributor/type filters through and returns unfiltered facets', async () => {
    const listForBrief = jest.fn().mockResolvedValue([]);
    const listContributorsForBrief = jest
      .fn()
      .mockResolvedValue([{ key: 'ada', commits: 4 }]);
    const service = makeService({
      findByIdScopedToOrg: jest.fn().mockResolvedValue({ id: 'b1' }),
      listForBrief,
      listContributorsForBrief,
    });

    const out = await service.getCommits('org1', 'b1', {
      limit: 50,
      contributor: 'ada',
      commitType: 'fix',
    });

    expect(listForBrief).toHaveBeenCalledWith(
      expect.objectContaining({ contributor: 'ada', commitType: 'fix' }),
    );
    // The facet query takes only the brief id: the dropdown must keep listing
    // every contributor while one of them is selected.
    expect(listContributorsForBrief).toHaveBeenCalledWith('b1');
    expect(out.contributors).toEqual([{ key: 'ada', commits: 4 }]);
  });

  it('maps a live commit row to a response with a github url', async () => {
    const service = makeService({
      findByIdScopedToOrg: jest.fn().mockResolvedValue({ id: 'b1' }),
      listForBrief: jest.fn().mockResolvedValue([
        {
          briefCommitId: 'bc1',
          sha: 'abc123',
          commitId: 'c1',
          authoredAt: new Date('2026-05-20T00:00:00Z'),
          authorName: 'Ada',
          authorLogin: 'ada',
          message: 'feat: x\n\nbody',
          repositoryFullName: 'acme/app',
          analysisStatus: 'analyzed',
          analysisCommitType: 'feature',
          analysisSummary: 'add X',
          analysisChanges: ['c1'],
        },
      ]),
    });
    const out = await service.getCommits('org1', 'b1', { limit: 50 });
    expect(out.items[0]).toEqual({
      sha: 'abc123',
      commitId: 'c1',
      repositoryFullName: 'acme/app',
      authorName: 'Ada',
      authorLogin: 'ada',
      messageFirstLine: 'feat: x',
      authoredAt: '2026-05-20T00:00:00.000Z',
      githubUrl: 'https://github.com/acme/app/commit/abc123',
      analysis: { commitType: 'feature', summary: 'add X', changes: ['c1'] },
    });
    expect(out.nextCursor).toBeNull();
  });

  it('maps a deleted-commit row to a bare-sha response', async () => {
    const service = makeService({
      findByIdScopedToOrg: jest.fn().mockResolvedValue({ id: 'b1' }),
      listForBrief: jest.fn().mockResolvedValue([
        {
          briefCommitId: 'bc2',
          sha: 'deadbeef',
          commitId: null,
          authoredAt: null,
          authorName: null,
          authorLogin: null,
          message: null,
          repositoryFullName: null,
          analysisStatus: null,
          analysisCommitType: null,
          analysisSummary: null,
          analysisChanges: null,
        },
      ]),
    });
    const out = await service.getCommits('org1', 'b1', { limit: 50 });
    expect(out.items[0]).toEqual({
      sha: 'deadbeef',
      commitId: null,
      repositoryFullName: null,
      authorName: null,
      authorLogin: null,
      messageFirstLine: null,
      authoredAt: null,
      githubUrl: null,
      analysis: null,
    });
  });
});

describe('BriefsService commit type counts', () => {
  function makeBriefRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'b1',
      organizationId: 'org1',
      briefScheduleId: null,
      scopeType: 'project',
      scopeProjectId: 'p1',
      scopeTeamId: null,
      scopeCollaboratorId: null,
      scopeRepositoryId: null,
      title: 'Week in review',
      briefInfoTitle: '',
      summary: 'stuff happened',
      periodStart: new Date('2026-06-01T00:00:00Z'),
      periodEnd: new Date('2026-06-07T00:00:00Z'),
      contributorCount: 4,
      commitCount: 24,
      status: 'delivered',
      failureReason: null,
      generatedAt: null,
      deliveredAt: null,
      createdAt: new Date('2026-06-08T00:00:00Z'),
      updatedAt: new Date('2026-06-08T00:00:00Z'),
      ...overrides,
    };
  }

  function makeService(deps: {
    list?: jest.Mock;
    findByIdScopedToOrg?: jest.Mock;
    countTypesForBriefs: jest.Mock;
  }) {
    const briefs = {
      list: deps.list ?? jest.fn().mockResolvedValue([]),
      findByIdScopedToOrg:
        deps.findByIdScopedToOrg ?? jest.fn().mockResolvedValue(null),
    };
    const briefCommits = {
      countTypesForBriefs: deps.countTypesForBriefs,
    };
    return new BriefsService(
      briefs as never,
      briefCommits as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null,
    );
  }

  it('list() zero-fills all 8 type keys and merges aggregate rows per brief', async () => {
    const countMock = jest.fn().mockResolvedValue([
      { briefId: 'b1', commitType: 'feature', count: 9 },
      { briefId: 'b1', commitType: 'fix', count: 7 },
      { briefId: 'b1', commitType: null, count: 3 },
    ]);
    const service = makeService({
      list: jest
        .fn()
        .mockResolvedValue([
          makeBriefRow(),
          makeBriefRow({ id: 'b2', commitCount: 0 }),
        ]),
      countTypesForBriefs: countMock,
    });

    const out = await service.list('org1', { limit: 20 });

    expect(countMock).toHaveBeenCalledWith(['b1', 'b2']);
    expect(out.items[0].commitTypeCounts).toEqual({
      feature: 9,
      fix: 7,
      optimization: 0,
      refactor: 0,
      docs: 0,
      test: 0,
      chore: 0,
      unclassified: 3,
    });
    // b2 has no brief_commits rows at all -> all zeros.
    expect(out.items[1].commitTypeCounts).toEqual({
      feature: 0,
      fix: 0,
      optimization: 0,
      refactor: 0,
      docs: 0,
      test: 0,
      chore: 0,
      unclassified: 0,
    });
  });

  it('list() maps unexpected type strings into unclassified', async () => {
    const service = makeService({
      list: jest.fn().mockResolvedValue([makeBriefRow()]),
      countTypesForBriefs: jest.fn().mockResolvedValue([
        { briefId: 'b1', commitType: 'mystery', count: 2 },
        { briefId: 'b1', commitType: null, count: 1 },
      ]),
    });

    const out = await service.list('org1', { limit: 20 });

    expect(out.items[0].commitTypeCounts.unclassified).toBe(3);
  });

  it('get() attaches counts for the single brief', async () => {
    const countMock = jest
      .fn()
      .mockResolvedValue([{ briefId: 'b1', commitType: 'docs', count: 2 }]);
    const service = makeService({
      findByIdScopedToOrg: jest.fn().mockResolvedValue(makeBriefRow()),
      countTypesForBriefs: countMock,
    });

    const out = await service.get('org1', 'b1');

    expect(countMock).toHaveBeenCalledWith(['b1']);
    expect(out.commitTypeCounts).toEqual({
      feature: 0,
      fix: 0,
      optimization: 0,
      refactor: 0,
      docs: 2,
      test: 0,
      chore: 0,
      unclassified: 0,
    });
  });
});

describe('BriefsService.list cursor validation', () => {
  function serviceWithList(listMock: jest.Mock) {
    return new BriefsService(
      { list: listMock } as never,
      { countTypesForBriefs: jest.fn().mockResolvedValue([]) } as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null,
    );
  }

  function cursor(payload: unknown): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  const VALID_ID = '6f2c1b90-8a7d-4c3e-9b21-0d5f8e114b3a';

  it('accepts a well-formed cursor', async () => {
    const listMock = jest.fn().mockResolvedValue([]);
    await serviceWithList(listMock).list('org1', {
      limit: 20,
      cursor: cursor({ periodEnd: '2026-06-07T00:00:00.000Z', id: VALID_ID }),
    });

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorId: VALID_ID,
        cursorPeriodEnd: new Date('2026-06-07T00:00:00.000Z'),
      }),
    );
  });

  // A non-uuid id used to reach `WHERE id < $1` against a uuid column and come
  // back as 22P02, which the exception filter could only render as a 500.
  it.each([
    ['a non-uuid id', { periodEnd: '2026-06-07T00:00:00.000Z', id: 'x' }],
    ['an unparseable date', { periodEnd: 'not-a-date', id: VALID_ID }],
    ['a missing id', { periodEnd: '2026-06-07T00:00:00.000Z' }],
  ])('rejects %s with 400 and never queries', async (_label, payload) => {
    const listMock = jest.fn();
    const service = serviceWithList(listMock);

    await expect(
      service.list('org1', { limit: 20, cursor: cursor(payload) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(listMock).not.toHaveBeenCalled();
  });
});

describe('BriefsService.delete', () => {
  function makeService(row: Record<string, unknown> | null) {
    const briefs = {
      findByIdScopedToOrg: jest.fn().mockResolvedValue(row),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BriefsService(
      briefs as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null,
    );
    return { service, briefs };
  }

  it('soft-deletes a hand-generated brief', async () => {
    const { service, briefs } = makeService({
      id: 'b1',
      organizationId: 'org1',
      briefScheduleId: null,
    });

    await service.delete('org1', 'b1');

    expect(briefs.softDelete).toHaveBeenCalledWith('b1');
  });

  it('refuses a brief that belongs to a schedule', async () => {
    const { service, briefs } = makeService({
      id: 'b1',
      organizationId: 'org1',
      briefScheduleId: 'sch1',
    });

    await expect(service.delete('org1', 'b1')).rejects.toMatchObject({
      code: 'BRIEF_NOT_DELETABLE',
    });
    expect(briefs.softDelete).not.toHaveBeenCalled();
  });

  it('404s an unknown brief', async () => {
    const { service, briefs } = makeService(null);

    await expect(service.delete('org1', 'b1')).rejects.toMatchObject({
      code: 'BRIEF_NOT_FOUND',
    });
    expect(briefs.softDelete).not.toHaveBeenCalled();
  });
});

describe('BriefsService.generateAdHoc timezone', () => {
  function makeService() {
    const create = jest.fn().mockResolvedValue({ id: 'b1' });
    const projects = {
      findByIdScopedToOrg: jest.fn().mockResolvedValue({ id: 'p1' }),
    };
    const queue = { enqueue: jest.fn().mockResolvedValue('job1') };
    // Default: nothing is being ingested, so the generate gate passes.
    const ingestStatus = {
      forOrganization: jest
        .fn()
        .mockResolvedValue({ repositories: [], ingesting: false }),
    };
    // ctor: (briefs, briefCommits, projects, teams, collaborators, repos,
    //        trackedBranches, queue, scopes, report, deliverer, ingestStatus)
    const service = new BriefsService(
      { create } as never,
      null as never,
      projects as never,
      null as never,
      null as never,
      null as never,
      null as never,
      queue as never,
      null as never,
      null as never,
      null as never,
      ingestStatus as never,
    );
    return { service, create, ingestStatus };
  }

  const BODY = {
    scope: {
      type: 'project' as const,
      projectId: '11111111-1111-4111-8111-111111111111',
    },
    periodStart: '2026-08-07T00:00:00.000Z',
    periodEnd: '2026-08-14T00:00:00.000Z',
  };

  it('snapshots the requested zone so the report tiles the caller days', async () => {
    const { service, create } = makeService();

    await service.generateAdHoc('org1', { ...BODY, timezone: 'Asia/Kolkata' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ periodTimezone: 'Asia/Kolkata' }),
    );
  });

  it('falls back to UTC when the request names no zone', async () => {
    const { service, create } = makeService();

    await service.generateAdHoc('org1', BODY);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ periodTimezone: 'UTC' }),
    );
  });

  // '+05:30' is accepted by Intl and by Postgres `AT TIME ZONE` — with inverted
  // sign semantics — so it has to die at the boundary, not in the database.
  it('rejects an offset string masquerading as a zone', async () => {
    const { service, create } = makeService();

    await expect(
      service.generateAdHoc('org1', { ...BODY, timezone: '+05:30' }),
    ).rejects.toMatchObject({ code: 'BRIEF_SCHEDULE_INVALID_TIMEZONE' });
    expect(create).not.toHaveBeenCalled();
  });

  // A brief is never rewritten, so one generated over a half-read history stays
  // wrong for good.
  it('refuses while commits are still being ingested', async () => {
    const { service, create, ingestStatus } = makeService();
    ingestStatus.forOrganization.mockResolvedValue({
      repositories: [],
      ingesting: true,
    });

    await expect(service.generateAdHoc('org1', BODY)).rejects.toMatchObject({
      code: 'BRIEF_COMMITS_PROCESSING',
    });
    expect(create).not.toHaveBeenCalled();
  });
});
