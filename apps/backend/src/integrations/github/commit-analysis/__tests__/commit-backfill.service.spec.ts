import { CommitBackfillService } from '../services/commit-backfill.service';

function makeMocks() {
  const repo = {
    id: 'repo-1',
    installationId: 'inst-1',
    fullName: 'acme/api',
  };
  const installation = {
    id: 'inst-1',
    githubInstallationId: 42n,
  };

  return {
    repo,
    installation,
    reposRepo: {
      findById: jest.fn(async () => repo),
    } as any,
    installsRepo: {
      findById: jest.fn(async () => installation),
    } as any,
    client: {
      getLatestCommitDate: jest.fn(async () => null),
      listCommits: jest.fn(async () => undefined),
    } as any,
    commitsRepo: {
      upsertMany: jest.fn(async (rows: Array<{ sha: string }>) =>
        rows.map((row) => ({ id: `c-${row.sha}`, sha: row.sha })),
      ),
      linkToBranch: jest.fn(async () => undefined),
      findShasOnBranch: jest.fn(async () => new Set<string>()),
      findNewestCommittedAtOnBranch: jest.fn(async () => null as Date | null),
    } as any,
    trackedBranchesRepo: {
      listByRepository: jest.fn(async () => ['main', 'develop']),
    } as any,
    collaboratorsRepo: {
      upsertManyFromCommitAuthors: jest.fn(async () => undefined),
    } as any,
  };
}

function makeService(overrides: Partial<ReturnType<typeof makeMocks>> = {}) {
  const m = { ...makeMocks(), ...overrides };
  return {
    svc: new CommitBackfillService(
      m.reposRepo,
      m.installsRepo,
      m.client,
      m.commitsRepo,
      m.trackedBranchesRepo,
      m.collaboratorsRepo,
    ),
    mocks: m,
  };
}

/**
 * A `listCommits` that streams: one `onPage` call per page, nothing returned.
 * Each argument is one page of shas.
 */
function streamPages(...pages: string[][]) {
  return async (
    _installationId: bigint,
    _fullName: string,
    _sinceISO: string,
    _branch: string,
    onPage: (commits: ReturnType<typeof makeCommit>[]) => Promise<void>,
  ) => {
    for (const shas of pages) {
      await onPage(shas.map(makeCommit));
    }
  };
}

function makeCommit(sha: string) {
  return {
    sha,
    parentCount: 1,
    message: `m-${sha}`,
    authorGithubUserId: 1n,
    authorGithubLogin: 'a',
    authorName: 'A',
    authorEmail: 'a@x',
    authorUser: {
      id: 1,
      login: 'a',
      node_id: 'MDQ6VXNlcjE=',
      avatar_url: 'https://avatars.example/1',
      html_url: 'https://github.com/a',
      type: 'User',
      site_admin: false,
    },
    committerGithubUserId: 1n,
    committerGithubLogin: 'a',
    committerName: 'A',
    committerEmail: 'a@x',
    authoredAt: new Date('2026-05-01T00:00:00Z'),
    committedAt: new Date('2026-05-01T00:00:01Z'),
    raw: { sha },
  };
}

describe('CommitBackfillService', () => {
  it('throws NOT_FOUND when repo is missing', async () => {
    const { svc, mocks } = makeService();
    mocks.reposRepo.findById.mockResolvedValueOnce(null);
    await expect(
      svc.run({
        repositoryId: 'repo-1',
        branch: 'main',
        sinceISO: '2025-05-01T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'GITHUB_REPOSITORY_NOT_FOUND' });
  });

  it('refuses a branch the repository is not tracked on', async () => {
    const { svc, mocks } = makeService();
    mocks.trackedBranchesRepo.listByRepository.mockResolvedValueOnce([
      'develop',
    ]);

    await expect(
      svc.run({
        repositoryId: 'repo-1',
        branch: 'main',
        sinceISO: '2025-05-01T00:00:00Z',
      }),
    ).rejects.toMatchObject({
      code: 'GITHUB_REPOSITORY_BRANCH_NOT_TRACKED',
    });
    // Never falls back to another branch, tracked or default.
    expect(mocks.client.listCommits).not.toHaveBeenCalled();
  });

  it('links every upserted commit to the branch it was fetched from', async () => {
    const { svc, mocks } = makeService();
    mocks.client.listCommits.mockImplementationOnce(streamPages(['a', 'b']));

    await svc.run({
      repositoryId: 'repo-1',
      branch: 'develop',
      sinceISO: '2025-05-01T00:00:00Z',
    });

    expect(mocks.commitsRepo.linkToBranch).toHaveBeenCalledWith(
      ['c-a', 'c-b'],
      'develop',
    );
  });

  it('reads commits from the configured branch and upserts in batches', async () => {
    const { svc, mocks } = makeService();
    mocks.client.listCommits.mockImplementationOnce(streamPages(['a', 'b']));

    await svc.run({
      repositoryId: 'repo-1',
      branch: 'main',
      sinceISO: '2025-05-01T00:00:00Z',
    });

    expect(mocks.client.listCommits).toHaveBeenCalledWith(
      42n,
      'acme/api',
      '2025-05-01T00:00:00Z',
      'main',
      expect.any(Function),
    );
    expect(mocks.commitsRepo.upsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          repositoryId: 'repo-1',
          sha: 'a',
          authorEmail: 'a@x',
        }),
        expect.objectContaining({ sha: 'b' }),
      ]),
    );
  });

  it('writes one page at a time instead of the whole history at once', async () => {
    const { svc, mocks } = makeService();
    mocks.client.listCommits.mockImplementationOnce(
      streamPages(['a', 'b'], ['c', 'd'], ['e']),
    );
    const progress: Array<{ inserted: number; pages: number }> = [];

    const result = await svc.run(
      {
        repositoryId: 'repo-1',
        branch: 'main',
        sinceISO: '2025-05-01T00:00:00Z',
      },
      (p) => progress.push(p),
    );

    // Three pages in, three writes out — never one write holding everything.
    expect(mocks.commitsRepo.upsertMany).toHaveBeenCalledTimes(3);
    expect(mocks.commitsRepo.linkToBranch).toHaveBeenCalledTimes(3);
    const writtenShas = mocks.commitsRepo.upsertMany.mock.calls.map(
      (call: [Array<{ sha: string }>]) => call[0].map((row) => row.sha),
    );
    expect(writtenShas).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(mocks.commitsRepo.linkToBranch).toHaveBeenNthCalledWith(
      2,
      ['c-c', 'c-d'],
      'main',
    );

    // Progress is reported per page (this is what the activity heartbeats), and
    // the total is still the whole history.
    expect(progress).toEqual([
      { inserted: 2, pages: 1 },
      { inserted: 4, pages: 2 },
      { inserted: 5, pages: 3 },
    ]);
    expect(result).toEqual({ inserted: 5 });
  });

  // Ingest is the only reliable source of collaborators: a GitHub App cannot
  // see access inherited from a fork's parent, so `/collaborators` returns
  // almost nobody for exactly the repositories with the most history.
  it('records each page of commit authors as collaborators', async () => {
    const { svc, mocks } = makeService();
    mocks.client.listCommits.mockImplementationOnce(streamPages(['a', 'b']));

    await svc.run({
      repositoryId: 'repo-1',
      branch: 'main',
      sinceISO: '2025-05-01T00:00:00Z',
    });

    expect(
      mocks.collaboratorsRepo.upsertManyFromCommitAuthors,
    ).toHaveBeenCalledWith([
      expect.objectContaining({
        githubUserId: 1n,
        login: 'a',
        nodeId: 'MDQ6VXNlcjE=',
        avatarUrl: 'https://avatars.example/1',
        htmlUrl: 'https://github.com/a',
        type: 'User',
        siteAdmin: false,
      }),
      expect.objectContaining({ githubUserId: 1n, login: 'a' }),
    ]);
  });

  it('skips commits GitHub could not match to an account', async () => {
    const { svc, mocks } = makeService();
    mocks.client.listCommits.mockImplementationOnce(
      async (
        _installationId: bigint,
        _fullName: string,
        _sinceISO: string,
        _branch: string,
        onPage: (commits: ReturnType<typeof makeCommit>[]) => Promise<void>,
      ) => {
        await onPage([{ ...makeCommit('a'), authorUser: null } as never]);
      },
    );

    await svc.run({
      repositoryId: 'repo-1',
      branch: 'main',
      sinceISO: '2025-05-01T00:00:00Z',
    });

    // Still called, with nothing — an unmatched author has no GitHub identity
    // to record, and must not abort the page's commit write.
    expect(
      mocks.collaboratorsRepo.upsertManyFromCommitAuthors,
    ).toHaveBeenCalledWith([]);
    expect(mocks.commitsRepo.upsertMany).toHaveBeenCalledTimes(1);
  });

  it('noops when no commits are returned', async () => {
    const { svc, mocks } = makeService();
    await svc.run({
      repositoryId: 'repo-1',
      branch: 'main',
      sinceISO: '2025-05-01T00:00:00Z',
    });
    expect(mocks.commitsRepo.upsertMany).not.toHaveBeenCalled();
  });

  /**
   * `landed_at` is the clock every new brief selects on, and these two cases are
   * the whole of how it gets its value. Getting the split wrong is not a subtle
   * regression: stamping the read's own clock on an import files a backfilled
   * year under the day the backfill ran, and stamping `committed_at` on an
   * incremental read puts a `--no-ff` merge's contents back into a period whose
   * brief already went out.
   */
  describe('landedAt', () => {
    const landedOf = (mocks: ReturnType<typeof makeMocks>) =>
      mocks.commitsRepo.upsertMany.mock.calls[0][0].map(
        (row: { landedAt: Date }) => row.landedAt,
      );

    it('stamps the read clock when the read is watching commits arrive', async () => {
      const { svc, mocks } = makeService();
      mocks.client.listCommits.mockImplementation(streamPages(['s1']));
      const before = Date.now();

      await svc.run({
        repositoryId: 'repo-1',
        branch: 'main',
        sinceISO: '2026-05-01T00:00:00Z',
        landedNow: true,
      });

      const [landedAt] = landedOf(mocks);
      expect(landedAt.getTime()).toBeGreaterThanOrEqual(before);
      // Not the commit's own dates, which is the entire point — a merge commit
      // backdates both of those.
      expect(landedAt).not.toEqual(makeCommit('s1').committedAt);
    });

    it('seeds committedAt when the read is importing history', async () => {
      const { svc, mocks } = makeService();
      mocks.client.listCommits.mockImplementation(streamPages(['s1', 's2']));

      // The default, so a caller that says nothing gets import semantics — that
      // is what keeps a manual backfill and an adopted branch from collapsing
      // their whole window into one brief period.
      await svc.run({
        repositoryId: 'repo-1',
        branch: 'main',
        sinceISO: '2026-05-01T00:00:00Z',
      });

      expect(landedOf(mocks)).toEqual([
        makeCommit('s1').committedAt,
        makeCommit('s2').committedAt,
      ]);
    });

    it('gives every page of one incremental read the same timestamp', async () => {
      const { svc, mocks } = makeService();
      mocks.client.listCommits.mockImplementation(
        streamPages(['s1'], ['s2'], ['s3']),
      );

      await svc.run({
        repositoryId: 'repo-1',
        branch: 'main',
        sinceISO: '2026-05-01T00:00:00Z',
        landedNow: true,
      });

      // A per-page clock would spread one arrival over minutes on a busy
      // repository and, on an unlucky boundary, across two brief periods.
      const stamps = mocks.commitsRepo.upsertMany.mock.calls.flatMap(
        (call: [Array<{ landedAt: Date }>]) =>
          call[0].map((row) => row.landedAt.getTime()),
      );
      expect(new Set(stamps).size).toBe(1);
    });

    it('never stamps the read clock on a first read of a branch', async () => {
      const { svc, mocks } = makeService();
      mocks.client.getLatestCommitDate.mockResolvedValueOnce(
        new Date('2026-05-10T00:00:00Z'),
      );
      mocks.client.listCommits.mockImplementation(streamPages(['s1']));

      await svc.runFromLatest({
        repositoryId: 'repo-1',
        branch: 'main',
        lookbackDays: 30,
      });

      expect(landedOf(mocks)).toEqual([makeCommit('s1').committedAt]);
    });
  });

  describe('runFromLatest', () => {
    it('computes since = latest - lookbackDays, pulls, and returns sinceISO', async () => {
      const { svc, mocks } = makeService();
      mocks.client.getLatestCommitDate.mockResolvedValueOnce(
        new Date('2026-05-10T00:00:00.000Z'),
      );
      mocks.client.listCommits.mockImplementationOnce(streamPages(['a', 'b']));

      const result = await svc.runFromLatest({
        repositoryId: 'repo-1',
        branch: 'main',
        lookbackDays: 90,
      });

      const expectedSince = new Date(
        Date.parse('2026-05-10T00:00:00.000Z') - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();

      expect(result).toEqual({ inserted: 2, sinceISO: expectedSince });
      expect(mocks.client.getLatestCommitDate).toHaveBeenCalledWith(
        42n,
        'acme/api',
        'main',
      );
      expect(mocks.client.listCommits).toHaveBeenCalledWith(
        42n,
        'acme/api',
        expectedSince,
        'main',
        expect.any(Function),
      );
      expect(mocks.commitsRepo.upsertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ repositoryId: 'repo-1', sha: 'a' }),
          expect.objectContaining({ sha: 'b' }),
        ]),
      );
    });

    it('returns sinceISO=null and pulls nothing for an empty repo', async () => {
      const { svc, mocks } = makeService();
      mocks.client.getLatestCommitDate.mockResolvedValueOnce(null);

      const result = await svc.runFromLatest({
        repositoryId: 'repo-1',
        branch: 'main',
        lookbackDays: 90,
      });

      expect(result).toEqual({ inserted: 0, sinceISO: null });
      expect(mocks.client.listCommits).not.toHaveBeenCalled();
      expect(mocks.commitsRepo.upsertMany).not.toHaveBeenCalled();
    });

    it('returns inserted=0 with a real sinceISO when no commits are in the window', async () => {
      const { svc, mocks } = makeService();
      mocks.client.getLatestCommitDate.mockResolvedValueOnce(
        new Date('2026-05-10T00:00:00.000Z'),
      );
      mocks.client.listCommits.mockImplementationOnce(streamPages());

      const result = await svc.runFromLatest({
        repositoryId: 'repo-1',
        branch: 'main',
        lookbackDays: 90,
      });

      const expectedSince = new Date(
        Date.parse('2026-05-10T00:00:00.000Z') - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
      expect(result).toEqual({ inserted: 0, sinceISO: expectedSince });
      expect(mocks.commitsRepo.upsertMany).not.toHaveBeenCalled();
    });
  });

  describe('planIngest', () => {
    const push = {
      repositoryId: 'repo-1',
      branch: 'main',
      shas: ['a', 'b'],
      truncated: false,
      earliestPushedISO: '2026-08-14T10:00:00.000Z',
    };

    it('skips a branch the repository does not read, before touching commits', async () => {
      const { svc, mocks } = makeService();
      mocks.trackedBranchesRepo.listByRepository.mockResolvedValueOnce([
        'develop',
      ]);

      const plan = await svc.planIngest(push);

      expect(plan).toEqual({ skip: 'untracked' });
      expect(mocks.commitsRepo.findShasOnBranch).not.toHaveBeenCalled();
    });

    it('skips when every pushed sha is already on the branch', async () => {
      const { svc, mocks } = makeService();
      mocks.commitsRepo.findShasOnBranch.mockResolvedValueOnce(
        new Set(['a', 'b']),
      );

      const plan = await svc.planIngest(push);

      expect(plan).toEqual({ skip: 'nothing-new' });
      expect(
        mocks.commitsRepo.findNewestCommittedAtOnBranch,
      ).not.toHaveBeenCalled();
    });

    // A commit stored from another branch is not attributed to this one, so it
    // still has to be fetched — otherwise this branch's briefs never see it.
    it('does not skip when a pushed sha exists but not on this branch', async () => {
      const { svc, mocks } = makeService();
      mocks.commitsRepo.findShasOnBranch.mockResolvedValueOnce(new Set(['a']));
      mocks.commitsRepo.findNewestCommittedAtOnBranch.mockResolvedValueOnce(
        new Date('2026-08-14T09:00:00.000Z'),
      );

      const plan = await svc.planIngest(push);

      expect(plan).toEqual({
        skip: null,
        mode: 'resume',
        sinceISO: '2026-08-14T09:00:00.000Z',
      });
    });

    it('resumes from the newest stored commit rather than a lookback window', async () => {
      const { svc, mocks } = makeService();
      mocks.commitsRepo.findNewestCommittedAtOnBranch.mockResolvedValueOnce(
        new Date('2026-08-14T09:59:00.000Z'),
      );

      const plan = await svc.planIngest(push);

      expect(plan).toEqual({
        skip: null,
        mode: 'resume',
        sinceISO: '2026-08-14T09:59:00.000Z',
      });
    });

    // Force-push to an older base: the stored high-water mark sits *past* the new
    // commits, so taking it alone would fetch none of them.
    it('takes the earliest pushed timestamp when it predates what is stored', async () => {
      const { svc, mocks } = makeService();
      mocks.commitsRepo.findNewestCommittedAtOnBranch.mockResolvedValueOnce(
        new Date('2026-08-14T23:00:00.000Z'),
      );

      const plan = await svc.planIngest(push);

      expect(plan).toEqual({
        skip: null,
        mode: 'resume',
        sinceISO: '2026-08-14T10:00:00.000Z',
      });
    });

    // No high-water mark to resume from, so the caller runs the same
    // lookback-bounded first read branch setup would have run.
    it('adopts a branch with nothing stored', async () => {
      const { svc } = makeService();

      const plan = await svc.planIngest(push);

      expect(plan).toEqual({ skip: null, mode: 'adopt' });
    });

    // The sweep names no shas at all — adoption must not depend on the trigger.
    it('adopts a branch with nothing stored on a sweep run', async () => {
      const { svc, mocks } = makeService();

      const plan = await svc.planIngest({
        repositoryId: 'repo-1',
        branch: 'main',
        shas: [],
        truncated: false,
        earliestPushedISO: null,
      });

      expect(plan).toEqual({ skip: null, mode: 'adopt' });
      expect(mocks.commitsRepo.findShasOnBranch).not.toHaveBeenCalled();
    });

    // Regression: adopting only on a sweep would let a push to a never-read branch
    // store its handful of commits and then resume from that mark forever, hiding
    // the older history with no signal.
    it('prefers adoption over the pushed timestamp when nothing is stored', async () => {
      const { svc } = makeService();

      const plan = await svc.planIngest(push);

      expect(plan).not.toHaveProperty('sinceISO');
    });

    // "Every sha we were told about is present" says nothing about the commits a
    // truncated payload did not name.
    it('does not apply the sha gate to a truncated payload', async () => {
      const { svc, mocks } = makeService();
      mocks.commitsRepo.findShasOnBranch.mockResolvedValueOnce(
        new Set(['a', 'b']),
      );
      mocks.commitsRepo.findNewestCommittedAtOnBranch.mockResolvedValueOnce(
        new Date('2026-08-14T09:00:00.000Z'),
      );

      const plan = await svc.planIngest({ ...push, truncated: true });

      expect(mocks.commitsRepo.findShasOnBranch).not.toHaveBeenCalled();
      expect(plan).toEqual({
        skip: null,
        mode: 'resume',
        sinceISO: '2026-08-14T09:00:00.000Z',
      });
    });
  });
});
