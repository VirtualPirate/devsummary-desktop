/**
 * Ported from `temporal/workflows/__tests__/analyze-repo.workflow.spec.ts` and
 * `ingest-new-commits.workflow.spec.ts`, plus the two acceptance cases the plan
 * adds for the loop rewrite (paging past 500 without a restart, and a sweep
 * that crosses midnight).
 *
 * Orchestration only: which activity ran with what, and which children were
 * enqueued with which ids. The gate logic itself is unit-tested on
 * `CommitBackfillService`.
 */
import { JOB, JobHandlerRegistry } from '../../../../jobs';
import { CommitAnalysisJobs } from './commit-analysis.jobs';
import type { CommitAnalysisActivities } from './commit-analysis.activities';
import type { LocStatsActivities } from './loc-stats.activities';

type EnqueueCall = [string, Record<string, unknown>, { id?: string }?];

function makeJobs(
  commitOverrides: Record<string, unknown> = {},
  locOverrides: Record<string, unknown> = {},
) {
  const commits = {
    // The params are declared, not inferred: `jest.fn(async () => …)` types
    // `mock.calls` as an empty tuple, and the cases below read the planner's
    // argument back off it.
    planRepoAnalysis: jest.fn(
      async (_input: {
        repositoryId: string;
        sinceISO: string;
        force: boolean;
        limit: number;
        after?: { authoredAt: string; id: string } | null;
      }) => ({
        commitIds: [] as string[],
        nextCursor: null,
      }),
    ),
    analyzeCommit: jest.fn(async (_input: { commitId: string }) => undefined),
    // One per call by default, which is what a keyed provider does — so the
    // cases below assert on `analyzeCommit` exactly as they did before
    // batching existed. `analyzeCommitBatch` delegating to it for a chunk of
    // one is the real activity's own first line.
    commitsPerCall: 1,
    analyzeCommitBatch: jest.fn(async function (
      this: { analyzeCommit: (i: { commitId: string }) => Promise<void> },
      { commitIds }: { commitIds: string[] },
    ) {
      for (const commitId of commitIds)
        await commits.analyzeCommit({ commitId });
    }),
    listSweepTargets: jest.fn(
      async (_input: {
        limit: number;
        after?: { repositoryId: string; branch: string } | null;
      }) => ({
        runDate: '2026-08-19',
        targets: [],
        nextCursor: null,
      }),
    ),
    planIngest: jest.fn(async () => ({ skip: 'nothing-new' })),
    backfillFromLatest: jest.fn(async () => ({
      inserted: 0,
      sinceISO: null as string | null,
    })),
    backfillCommits: jest.fn(async () => ({ inserted: 0 })),
    ...commitOverrides,
  };
  const loc = {
    zeroFillAndFindMissing: jest.fn(async () => ({
      repositoryIds: [] as string[],
    })),
    pageRepo: jest.fn(
      async (_input: { repositoryId: string; cursor: string | null }) => ({
        nextCursor: null as string | null,
      }),
    ),
    ...locOverrides,
  };
  const queue = {
    enqueue: jest.fn(
      async (_t: string, _a: unknown, opts?: { id?: string }) =>
        opts?.id ?? 'job-id',
    ),
    isAborted: jest.fn(() => false),
  };
  const registry = new JobHandlerRegistry();
  const jobs = new CommitAnalysisJobs(
    commits as unknown as CommitAnalysisActivities,
    loc as unknown as LocStatsActivities,
    queue as never,
    registry,
  );
  const enqueued = () => queue.enqueue.mock.calls as unknown as EnqueueCall[];
  return { jobs, commits, loc, queue, registry, enqueued };
}

describe('CommitAnalysisJobs — analysis.analyzeRepo (was AnalyzeRepoWorkflow)', () => {
  it('analyzes every planned commit exactly once', async () => {
    const analyzed: string[] = [];
    const { jobs } = makeJobs({
      planRepoAnalysis: jest.fn(async () => ({
        commitIds: ['c1', 'c2', 'c3'],
        nextCursor: null,
      })),
      analyzeCommit: jest.fn(async (input: { commitId: string }) => {
        analyzed.push(input.commitId);
      }),
    });

    await jobs.analyzeRepo({
      repositoryId: 'r1',
      sinceISO: '2026-01-01T00:00:00Z',
      force: false,
    });

    expect(analyzed).toHaveLength(3);
    expect(analyzed.slice().sort()).toEqual(['c1', 'c2', 'c3']);
  });

  /**
   * PAGE stays 500. What changed is the mechanism: `continueAsNew` became a
   * `while (cursor)` inside one handler, so a repository past a page is walked
   * by the loop, not by a workflow restart. The cursor — not the remaining ids
   * — is still what advances, which is what keeps the planner's argument two
   * fields wide no matter how large the repository is.
   */
  it('pages past 500 commits inside its own loop, carrying the cursor and not the remaining ids', async () => {
    const analyzed: string[] = [];
    const cursorsSeen: Array<{ authoredAt: string; id: string } | null> = [];
    const argumentSizes: number[] = [];

    const { jobs, commits } = makeJobs({
      planRepoAnalysis: jest.fn(
        async (input: {
          limit: number;
          after?: { authoredAt: string; id: string } | null;
        }) => {
          cursorsSeen.push(input.after ?? null);
          argumentSizes.push(JSON.stringify(input).length);
          const run = cursorsSeen.length;
          // Two full pages, then a short one that ends the chain.
          if (run > 2) return { commitIds: ['tail'], nextCursor: null };
          return {
            commitIds: Array.from(
              { length: input.limit },
              (_, i) => `p${run}-c${i}`,
            ),
            nextCursor: {
              authoredAt: `2026-01-0${run}T00:00:00.000Z`,
              id: `p${run}-c${input.limit - 1}`,
            },
          };
        },
      ),
      analyzeCommit: jest.fn(async (input: { commitId: string }) => {
        analyzed.push(input.commitId);
      }),
    });

    await jobs.analyzeRepo({
      repositoryId: 'r1',
      sinceISO: '2026-01-01T00:00:00Z',
      force: false,
      organizationId: 'org-1',
    });

    expect(commits.planRepoAnalysis).toHaveBeenCalledTimes(3);
    expect(cursorsSeen).toEqual([
      null,
      { authoredAt: '2026-01-01T00:00:00.000Z', id: 'p1-c499' },
      { authoredAt: '2026-01-02T00:00:00.000Z', id: 'p2-c499' },
    ]);
    expect(analyzed).toHaveLength(1001);
    expect(new Set(analyzed).size).toBe(1001);
    // The point of the cursor: what crosses a page boundary does not grow with
    // the repository. 1001 commit ids would be ~14 KB.
    expect(Math.max(...argumentSizes)).toBeLessThan(300);
    // PAGE is 500 and unchanged.
    expect(commits.planRepoAnalysis.mock.calls[0][0]).toMatchObject({
      limit: 500,
    });
  });

  /**
   * `Promise.allSettled`, kept from the workflow. A commit that exhausts its
   * retries has already persisted its failure via `recordFailed` before
   * throwing, so it must not abort its batch, its page, or the pages after it.
   */
  it('does not abort the remaining pages when a commit analysis fails mid-loop', async () => {
    const analyzed: string[] = [];
    const { jobs, commits } = makeJobs({
      planRepoAnalysis: jest.fn(
        async (input: { after?: unknown; limit: number }) => {
          if (!input.after) {
            return {
              commitIds: ['a1', 'boom', 'a3'],
              nextCursor: { authoredAt: '2026-01-01T00:00:00.000Z', id: 'a3' },
            };
          }
          return { commitIds: ['b1', 'b2'], nextCursor: null };
        },
      ),
      analyzeCommit: jest.fn(async (input: { commitId: string }) => {
        if (input.commitId === 'boom') throw new Error('openai 503');
        analyzed.push(input.commitId);
      }),
    });

    await expect(
      jobs.analyzeRepo({
        repositoryId: 'r1',
        sinceISO: '2026-01-01T00:00:00Z',
        force: false,
      }),
    ).resolves.toBeUndefined();

    expect(commits.planRepoAnalysis).toHaveBeenCalledTimes(2);
    // Both siblings in the failing batch AND the whole second page still ran.
    expect(analyzed).toEqual(['a1', 'a3', 'b1', 'b2']);
  });

  /** BATCH 50 → 5 (plan R11): the fan-out spends the user's own OpenAI quota. */
  it('fans out at most 5 commit analyses at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const { jobs } = makeJobs({
      planRepoAnalysis: jest.fn(async () => ({
        commitIds: Array.from({ length: 23 }, (_, i) => `c${i}`),
        nextCursor: null,
      })),
      analyzeCommit: jest.fn(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
      }),
    });

    await jobs.analyzeRepo({
      repositoryId: 'r1',
      sinceISO: '2026-01-01T00:00:00Z',
      force: false,
    });

    expect(peak).toBe(5);
  });

  // The reason the fan-out is a rolling pool and not `allSettled` over slices
  // of five. One analysis is a whole CLI process on an agent provider and its
  // latency varies 13–29 s, so a slice that waits for its slowest member idles
  // four slots while it does. Here one commit never settles until the end: a
  // pool keeps working around it, lockstep slices would stall on the first
  // slice forever.
  it('keeps the other slots working while one analysis hangs', async () => {
    let releaseHung = () => {};
    const hung = new Promise<void>((resolve) => {
      releaseHung = resolve;
    });
    const done: string[] = [];
    const { jobs } = makeJobs({
      planRepoAnalysis: jest.fn(async () => ({
        commitIds: Array.from({ length: 12 }, (_, i) => `c${i}`),
        nextCursor: null,
      })),
      analyzeCommit: jest.fn(async ({ commitId }: { commitId: string }) => {
        if (commitId === 'c0') await hung;
        done.push(commitId);
      }),
    });

    const run = jobs.analyzeRepo({
      repositoryId: 'r1',
      sinceISO: '2026-01-01T00:00:00Z',
      force: false,
    });

    // Every commit but the hung one, on four workers, while the fifth waits.
    await new Promise((resolve) => setImmediate(resolve));
    expect(done).toHaveLength(11);
    expect(done).not.toContain('c0');

    releaseHung();
    await run;
    expect(done).toHaveLength(12);
  });

  // On an agent CLI a call is a process, so the page is chunked and the pool
  // works over chunks. 10 commits at 4 per call is 3 calls, the last short.
  it('packs the page into calls of `commitsPerCall` for a CLI provider', async () => {
    const { jobs, commits } = makeJobs({
      commitsPerCall: 4,
      planRepoAnalysis: jest.fn(async () => ({
        commitIds: Array.from({ length: 10 }, (_, i) => `c${i}`),
        nextCursor: null,
      })),
    });

    await jobs.analyzeRepo({
      repositoryId: 'r1',
      sinceISO: '2026-01-01T00:00:00Z',
      force: false,
    });

    expect(
      commits.analyzeCommitBatch.mock.calls.map(([a]) => a.commitIds),
    ).toEqual([
      ['c0', 'c1', 'c2', 'c3'],
      ['c4', 'c5', 'c6', 'c7'],
      ['c8', 'c9'],
    ]);
  });

  it('stops mid-loop when the organization is being torn down', async () => {
    const { jobs, queue, commits } = makeJobs({
      planRepoAnalysis: jest.fn(async () => ({
        commitIds: ['c1'],
        nextCursor: { authoredAt: '2026-01-01T00:00:00.000Z', id: 'c1' },
      })),
    });
    queue.isAborted.mockReturnValueOnce(false).mockReturnValue(true);

    await jobs.analyzeRepo({
      repositoryId: 'r1',
      sinceISO: '2026-01-01T00:00:00Z',
      force: false,
      organizationId: 'org-doomed',
    });

    expect(commits.planRepoAnalysis).toHaveBeenCalledTimes(1);
  });
});

describe('CommitAnalysisJobs — github.sweep (was SweepRepositoriesWorkflow)', () => {
  /**
   * The `runDate` stamping. A workflow could not read a clock, so the activity
   * stamped the date and `continueAsNew` carried it; the loop carries it the
   * same way. Without it, a sweep whose second page lands after midnight would
   * give that page's children a different id namespace and re-run every
   * repository the next night's sweep already has in flight.
   */
  it('gives every child the same id namespace when the sweep crosses midnight', async () => {
    const { jobs, enqueued } = makeJobs({
      listSweepTargets: jest
        .fn()
        .mockResolvedValueOnce({
          runDate: '2026-08-19',
          targets: [
            { repositoryId: 'r1', branch: 'main', organizationId: 'org-1' },
          ],
          nextCursor: { repositoryId: 'r1', branch: 'main' },
        })
        // Midnight crossed: the activity now stamps the *next* day.
        .mockResolvedValueOnce({
          runDate: '2026-08-20',
          targets: [
            { repositoryId: 'r2', branch: 'main', organizationId: 'org-1' },
          ],
          nextCursor: null,
        }),
    });

    await jobs.sweep({});

    expect(enqueued().map((c) => c[2]?.id)).toEqual([
      'sweep:r1:main:2026-08-19',
      'sweep:r2:main:2026-08-19',
    ]);
    // And the child's own `runKey` is the same date, so its analysis
    // grandchild id is stable too.
    for (const call of enqueued()) {
      expect(call[1]).toMatchObject({ runKey: '2026-08-19', trigger: 'sweep' });
    }
  });

  it('pages the tracked set with the cursor and enqueues one child per target', async () => {
    const { jobs, commits, enqueued } = makeJobs({
      listSweepTargets: jest
        .fn()
        .mockResolvedValueOnce({
          runDate: '2026-08-19',
          targets: [
            { repositoryId: 'r1', branch: 'main', organizationId: 'org-1' },
            { repositoryId: 'r2', branch: 'dev', organizationId: 'org-2' },
          ],
          nextCursor: { repositoryId: 'r2', branch: 'dev' },
        })
        .mockResolvedValueOnce({
          runDate: '2026-08-19',
          targets: [
            { repositoryId: 'r3', branch: 'main', organizationId: 'org-2' },
          ],
          nextCursor: null,
        }),
    });

    await jobs.sweep();

    expect(commits.listSweepTargets.mock.calls.map((c) => c[0])).toEqual([
      { limit: 200, after: null },
      { limit: 200, after: { repositoryId: 'r2', branch: 'dev' } },
    ]);
    expect(enqueued()).toHaveLength(3);
    expect(enqueued()[0][0]).toBe(JOB.ingestNewCommits);
    expect(enqueued()[0][2]).toMatchObject({
      phase: 'fetching',
      organizationId: 'org-1',
    });
  });
});

describe('CommitAnalysisJobs — github.ingestNewCommits (was IngestNewCommitsWorkflow)', () => {
  const sweepInput = {
    repositoryId: 'r1',
    branch: 'main',
    trigger: 'sweep' as const,
    runKey: '2026-08-14',
    organizationId: 'org-1',
  };

  it('resumes from the planned window without a lookback read', async () => {
    const { jobs, commits } = makeJobs({
      planIngest: jest.fn(async () => ({
        skip: null,
        mode: 'resume',
        sinceISO: '2026-08-13T16:04:00.000Z',
      })),
      backfillCommits: jest.fn(async () => ({ inserted: 3 })),
    });

    await jobs.ingestNewCommits(sweepInput);

    expect(commits.backfillFromLatest).not.toHaveBeenCalled();
    expect(commits.backfillCommits).toHaveBeenCalledWith({
      repositoryId: 'r1',
      branch: 'main',
      sinceISO: '2026-08-13T16:04:00.000Z',
    });
  });

  it('adopts a branch with no stored history via a bounded lookback read', async () => {
    const { jobs, commits } = makeJobs({
      planIngest: jest.fn(async () => ({ skip: null, mode: 'adopt' })),
      backfillFromLatest: jest.fn(async () => ({
        inserted: 12,
        sinceISO: '2026-07-15T00:00:00.000Z',
      })),
    });

    await jobs.ingestNewCommits(sweepInput);

    expect(commits.backfillCommits).not.toHaveBeenCalled();
    // Bounded: the adopted read carries a lookback, not "everything".
    expect(commits.backfillFromLatest).toHaveBeenCalledWith({
      repositoryId: 'r1',
      branch: 'main',
      lookbackDays: 30,
    });
  });

  it('makes no GitHub call at all when the plan skips', async () => {
    const { jobs, commits, queue } = makeJobs();

    await jobs.ingestNewCommits(sweepInput);

    expect(commits.planIngest).toHaveBeenCalledTimes(1);
    expect(commits.backfillCommits).not.toHaveBeenCalled();
    expect(commits.backfillFromLatest).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues no analysis child when an adopted branch turns out to be empty', async () => {
    const { jobs, queue } = makeJobs({
      planIngest: jest.fn(async () => ({ skip: null, mode: 'adopt' })),
      backfillFromLatest: jest.fn(async () => ({
        inserted: 0,
        sinceISO: null,
      })),
    });

    await jobs.ingestNewCommits(sweepInput);

    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('keys the analysis child on runKey, not on the derived window', async () => {
    const { jobs, enqueued } = makeJobs({
      planIngest: jest.fn(async () => ({
        skip: null,
        mode: 'resume',
        sinceISO: '2026-08-13T16:04:00.000Z',
      })),
    });

    await jobs.ingestNewCommits(sweepInput);

    expect(enqueued()[0][0]).toBe(JOB.analyzeRepo);
    expect(enqueued()[0][2]).toMatchObject({
      id: 'analyze:r1:main:2026-08-14',
      phase: 'analyzing',
      organizationId: 'org-1',
    });
    expect(enqueued()[0][1]).toEqual({
      repositoryId: 'r1',
      sinceISO: '2026-08-13T16:04:00.000Z',
      force: false,
      organizationId: 'org-1',
    });
  });
});

describe('CommitAnalysisJobs — github.scanRepository (was ScanRepositoryWorkflow)', () => {
  it('enqueues an analysis child keyed on the repository, branch and window', async () => {
    const { jobs, commits, enqueued } = makeJobs({
      backfillFromLatest: jest.fn(async () => ({
        inserted: 40,
        sinceISO: '2026-05-21T00:00:00.000Z',
      })),
    });

    await jobs.scanRepository({
      repositoryId: 'r1',
      branch: 'develop',
      lookbackDays: 90,
      organizationId: 'org-1',
    });

    expect(commits.backfillFromLatest).toHaveBeenCalledWith({
      repositoryId: 'r1',
      branch: 'develop',
      lookbackDays: 90,
    });
    expect(enqueued()[0][2]).toMatchObject({
      id: 'analyze:r1:develop:2026-05-21T00:00:00.000Z',
      phase: 'analyzing',
    });
  });

  it('enqueues nothing for a repository GitHub reports as empty', async () => {
    const { jobs, queue } = makeJobs();

    await jobs.scanRepository({
      repositoryId: 'r1',
      branch: 'main',
      lookbackDays: 30,
    });

    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe('CommitAnalysisJobs — github.backfillCommits + loc', () => {
  it('backfillCommits forwards its window to the activity and starts nothing else', async () => {
    const { jobs, commits, queue } = makeJobs();

    await jobs.backfillCommits({
      repositoryId: 'r1',
      branch: 'main',
      sinceISO: '2026-01-01T00:00:00Z',
    });

    expect(commits.backfillCommits).toHaveBeenCalledWith({
      repositoryId: 'r1',
      branch: 'main',
      sinceISO: '2026-01-01T00:00:00Z',
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('loc.backfill fans out one deduped child per repository with missing stats', async () => {
    const { jobs, enqueued } = makeJobs(
      {},
      {
        zeroFillAndFindMissing: jest.fn(async () => ({
          repositoryIds: ['r1', 'r2'],
        })),
      },
    );

    await jobs.backfillLocStats();

    expect(enqueued().map((c) => [c[0], c[1], c[2]?.id])).toEqual([
      [
        JOB.backfillRepoLocStats,
        { repositoryId: 'r1', cursor: null },
        'loc:r1',
      ],
      [
        JOB.backfillRepoLocStats,
        { repositoryId: 'r2', cursor: null },
        'loc:r2',
      ],
    ]);
  });

  it('loc.backfillRepo pages until the cursor runs out (was continue-as-new)', async () => {
    jest.useFakeTimers();
    try {
      const { jobs, loc } = makeJobs(
        {},
        {
          pageRepo: jest
            .fn()
            .mockResolvedValueOnce({ nextCursor: 'cur-2' })
            .mockResolvedValueOnce({ nextCursor: 'cur-3' })
            .mockResolvedValueOnce({ nextCursor: null }),
        },
      );

      const done = jobs.backfillRepoLocStats({
        repositoryId: 'r1',
        cursor: null,
      });
      // Two 5s pauses between the three pages — the old `sleep('5s')`.
      await jest.advanceTimersByTimeAsync(10_000);
      await done;

      expect(loc.pageRepo.mock.calls.map((c) => c[0])).toEqual([
        { repositoryId: 'r1', cursor: null },
        { repositoryId: 'r1', cursor: 'cur-2' },
        { repositoryId: 'r1', cursor: 'cur-3' },
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('CommitAnalysisJobs — registration', () => {
  it('registers all seven ingest/analysis job types', () => {
    const { jobs, registry } = makeJobs();
    jobs.onModuleInit();

    for (const type of [
      JOB.analyzeRepo,
      JOB.sweepRepositories,
      JOB.ingestNewCommits,
      JOB.scanRepository,
      JOB.backfillCommits,
      JOB.backfillLocStats,
      JOB.backfillRepoLocStats,
    ]) {
      expect(registry.get(type)).toBeDefined();
    }
  });

  it('routes a job row through to the right handler', async () => {
    const { jobs, commits, registry } = makeJobs();
    jobs.onModuleInit();

    await registry.get(JOB.scanRepository)!(
      { repositoryId: 'r1', branch: 'main', lookbackDays: 30 },
      {} as never,
    );

    expect(commits.backfillFromLatest).toHaveBeenCalledWith({
      repositoryId: 'r1',
      branch: 'main',
      lookbackDays: 30,
    });
  });
});
