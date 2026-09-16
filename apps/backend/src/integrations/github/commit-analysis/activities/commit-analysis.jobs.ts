import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { JOB, JobHandlerRegistry, JobQueueService } from '../../../../jobs';
import { CommitAnalysisActivities } from './commit-analysis.activities';
import { LocStatsActivities } from './loc-stats.activities';

/** Commits planned per page. Unchanged from `AnalyzeRepoWorkflow`. */
const PAGE = 500;

/**
 * Commits analysed concurrently. Was 50 on the cloud, where the fan-out ran
 * against a pooled organisation key; here it spends the user's own OpenAI
 * quota from one laptop, so 5 (plan R11).
 *
 * It is a ceiling, not a promise: an agent-CLI provider gates itself lower
 * still (`DEFAULT_MAX_CONCURRENT`, half the machine's cores), because there a
 * call is a local process rather than a socket.
 */
const BATCH = 5;

/** Tracked (repository, branch) pairs planned per sweep page. */
const SWEEP_PAGE = 200;

/** Mirrors the old `REQUEUE_DELAY_SECONDS` sleep between LOC pages. */
const LOC_PAGE_DELAY_MS = 5_000;

/** See `IngestNewCommitsWorkflow`: how far back an *adopted* branch is read. */
const ADOPT_LOOKBACK_DAYS = 30;

export interface AnalyzeRepoInput {
  repositoryId: string;
  sinceISO: string;
  force: boolean;
  organizationId?: string;
  /** Where to resume from. Was carried across `continueAsNew`; now the loop. */
  cursor?: { authoredAt: string; id: string } | null;
}

export interface SweepRepositoriesInput {
  cursor?: { repositoryId: string; branch: string } | null;
  /**
   * Stamped by the first page's activity and then held for the whole run, so
   * every child of one sweep shares an id even if the sweep crosses midnight.
   */
  runDate?: string;
}

export interface IngestNewCommitsInput {
  repositoryId: string;
  branch: string;
  trigger: 'push' | 'sweep';
  /** Whatever makes this run distinct: the date for a sweep. */
  runKey: string;
  shas?: string[];
  truncated?: boolean;
  earliestPushedISO?: string | null;
  organizationId?: string;
}

export interface ScanRepositoryInput {
  repositoryId: string;
  branch: string;
  lookbackDays: number;
  organizationId?: string;
}

export interface BackfillCommitsInput {
  repositoryId: string;
  branch: string;
  sinceISO: string;
  organizationId?: string;
}

export interface BackfillRepoLocStatsInput {
  repositoryId: string;
  cursor: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The seven ingest/analysis workflows as plain handlers.
 *
 * `continueAsNew` became `while (cursor)` — the whole point of the Temporal
 * boundary was to bound replay history, and there is no history here. The
 * cursor still travels one page at a time rather than the remaining ids, so a
 * crash mid-run resumes at a page boundary instead of restarting a repository.
 *
 * `startChild(..., ABANDON)` became `queue.enqueue(type, args, { id })` with
 * the same stable id, which is what keeps `IngestStatusService` able to read a
 * repository out of a running job.
 */
@Injectable()
export class CommitAnalysisJobs implements OnModuleInit {
  private readonly logger = new Logger(CommitAnalysisJobs.name);

  constructor(
    private readonly commits: CommitAnalysisActivities,
    private readonly loc: LocStatsActivities,
    private readonly queue: JobQueueService,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.analyzeRepo, (args, job) =>
      this.analyzeRepo(args as unknown as AnalyzeRepoInput, job.id),
    );
    this.registry.register(JOB.sweepRepositories, (args, job) =>
      this.sweep(args, job.id),
    );
    this.registry.register(JOB.ingestNewCommits, (args) =>
      this.ingestNewCommits(args as unknown as IngestNewCommitsInput),
    );
    this.registry.register(JOB.scanRepository, (args) =>
      this.scanRepository(args as unknown as ScanRepositoryInput),
    );
    this.registry.register(JOB.backfillCommits, (args) =>
      this.backfillCommits(args as unknown as BackfillCommitsInput),
    );
    this.registry.register(JOB.backfillLocStats, () => this.backfillLocStats());
    this.registry.register(JOB.backfillRepoLocStats, (args, job) =>
      this.backfillRepoLocStats(
        args as unknown as BackfillRepoLocStatsInput,
        job.id,
      ),
    );
  }

  async analyzeRepo(input: AnalyzeRepoInput, jobId?: string): Promise<void> {
    let cursor = input.cursor ?? null;

    do {
      if (this.queue.isAborted(input.organizationId)) return;

      // One page planned fresh each iteration: the planner pages by cursor, so
      // the next turn asks for the next page rather than replaying a list.
      const planned = await this.commits.planRepoAnalysis({
        repositoryId: input.repositoryId,
        sinceISO: input.sinceISO,
        force: input.force,
        limit: PAGE,
        after: cursor,
      });

      // A rolling pool of `BATCH` workers over chunks, not lockstep slices.
      // One analysis is a whole CLI process on an agent provider and its
      // latency varies wildly — 13.3 s to 29.1 s across three commits,
      // measured — so a fixed slice left every finished slot idle until the
      // slowest of its five returned. A worker that takes the next id instead
      // keeps all five busy to the end of the page. `next++` needs no lock:
      // the increment is synchronous and there is no await between the read
      // and the write.
      //
      // Each worker swallows its own failures for the reason the previous
      // `allSettled` did: one commit exhausting its retries must not abort the
      // rest of the page or the pages after it, and `recordFailed` has already
      // persisted the reason before the throw, so nothing is lost here.
      // Chunked by what one LLM call should carry — one commit for a keyed
      // provider, `COMMITS_PER_CALL` for an agent CLI, where a call is a
      // process and its startup is most of the cost. Read per page, so
      // switching provider in the settings screen lands on the next page.
      const perCall = this.commits.commitsPerCall;
      const chunks: string[][] = [];
      for (let i = 0; i < planned.commitIds.length; i += perCall) {
        chunks.push(planned.commitIds.slice(i, i + perCall));
      }

      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(BATCH, chunks.length) }, async () => {
          while (next < chunks.length) {
            // Re-checked per chunk, not per page: an abort during a long page
            // used to run to the end of it.
            if (this.queue.isAborted(input.organizationId)) return;
            const commitIds = chunks[next++];
            try {
              await this.commits.analyzeCommitBatch({ commitIds });
            } catch {
              // Recorded by `recordFailed`; the job row carries the retry.
            }
          }
        }),
      );

      cursor = planned.nextCursor;
      await this.checkpoint(jobId, { ...input, cursor });
    } while (cursor);
  }

  async sweep(
    input: SweepRepositoriesInput = {},
    jobId?: string,
  ): Promise<void> {
    let cursor = input.cursor ?? null;
    // The first page owns the date; later pages keep it so child ids stay
    // stable even if a large install's sweep crosses midnight.
    let runDate = input.runDate;

    do {
      const page = await this.commits.listSweepTargets({
        limit: SWEEP_PAGE,
        after: cursor,
      });
      runDate ??= page.runDate;

      for (const target of page.targets) {
        if (this.queue.isAborted(target.organizationId)) continue;
        await this.queue.enqueue(
          JOB.ingestNewCommits,
          {
            repositoryId: target.repositoryId,
            branch: target.branch,
            trigger: 'sweep',
            runKey: runDate,
            organizationId: target.organizationId,
          } satisfies IngestNewCommitsInput,
          {
            id: `sweep:${target.repositoryId}:${target.branch}:${runDate}`,
            phase: 'fetching',
            organizationId: target.organizationId,
          },
        );
      }

      cursor = page.nextCursor;
      await this.checkpoint(jobId, { ...input, cursor, runDate });
    } while (cursor);
  }

  async ingestNewCommits(input: IngestNewCommitsInput): Promise<void> {
    const plan = await this.commits.planIngest({
      repositoryId: input.repositoryId,
      branch: input.branch,
      shas: input.shas ?? [],
      truncated: input.truncated ?? false,
      earliestPushedISO: input.earliestPushedISO ?? null,
    });
    if (plan.skip !== null) return;

    // Two shapes of read. `resume` continues from what is stored; `adopt` is
    // the first read of a branch that has nothing — the same activity (and so
    // the same "latest commit minus lookback" window) `scanRepository` uses, so
    // a branch whose setup scan never landed converges on the next run rather
    // than staying empty forever.
    let sinceISO: string;
    if (plan.mode === 'adopt') {
      const adopted = await this.commits.backfillFromLatest({
        repositoryId: input.repositoryId,
        branch: input.branch,
        lookbackDays: ADOPT_LOOKBACK_DAYS,
      });
      // Null means GitHub reports no commits on the branch at all — a genuinely
      // empty repository. Nothing to analyse, and no mark to store, so the next
      // run adopts it again (one cheap API call a night until it has a commit).
      if (adopted.sinceISO === null) return;
      sinceISO = adopted.sinceISO;
    } else {
      await this.commits.backfillCommits({
        repositoryId: input.repositoryId,
        branch: input.branch,
        sinceISO: plan.sinceISO,
      });
      sinceISO = plan.sinceISO;
    }

    // Keyed on `runKey`, not on `sinceISO`: two runs minutes apart can derive
    // the same window. Same `analyze:<repositoryId>:…` shape
    // `IngestStatusService` reads a repository out of.
    await this.enqueueAnalyze(
      input.repositoryId,
      sinceISO,
      input.organizationId,
      `analyze:${input.repositoryId}:${input.branch}:${input.runKey}`,
    );
  }

  async scanRepository(input: ScanRepositoryInput): Promise<void> {
    const { sinceISO } = await this.commits.backfillFromLatest({
      repositoryId: input.repositoryId,
      branch: input.branch,
      lookbackDays: input.lookbackDays,
    });
    if (sinceISO === null) return;

    // Explicit id, not a generated one, so the repository is readable from the
    // job id — that is what lets the onboarding console report analysis
    // progress *per repository* without a repositoryId column.
    await this.enqueueAnalyze(
      input.repositoryId,
      sinceISO,
      input.organizationId,
      `analyze:${input.repositoryId}:${input.branch}:${sinceISO}`,
    );
  }

  async backfillCommits(input: BackfillCommitsInput): Promise<void> {
    await this.commits.backfillCommits({
      repositoryId: input.repositoryId,
      branch: input.branch,
      sinceISO: input.sinceISO,
    });
  }

  async backfillLocStats(): Promise<void> {
    const { repositoryIds } = await this.loc.zeroFillAndFindMissing();
    for (const repositoryId of repositoryIds) {
      await this.queue.enqueue(
        JOB.backfillRepoLocStats,
        { repositoryId, cursor: null } satisfies BackfillRepoLocStatsInput,
        { id: `loc:${repositoryId}` },
      );
    }
  }

  async backfillRepoLocStats(
    input: BackfillRepoLocStatsInput,
    jobId?: string,
  ): Promise<void> {
    let cursor = input.cursor;
    for (;;) {
      const { nextCursor } = await this.loc.pageRepo({
        repositoryId: input.repositoryId,
        cursor,
      });
      if (nextCursor === null) return;
      cursor = nextCursor;
      await this.checkpoint(jobId, { ...input, cursor });
      this.logger.debug(`[loc.backfillRepo] ${input.repositoryId} next page`);
      await sleep(LOC_PAGE_DELAY_MS);
    }
  }

  /**
   * Where the next attempt should pick up.
   *
   * A retry re-runs the handler with the row's `args`, so without this a
   * failure on page 40 replays pages 1-39: on a sweep that re-enqueues every
   * repository already ingested this run (their rows were deleted on success,
   * so the stable id no longer dedupes them), and on `analyzeRepo` it re-plans
   * every page. Written after the page, so a crash resumes at the page that
   * was interrupted rather than skipping it.
   *
   * `jobId` is absent when a handler is called directly rather than through
   * the runner — nothing to resume, nothing to write.
   */
  private async checkpoint(
    jobId: string | undefined,
    args: AnalyzeRepoInput | SweepRepositoriesInput | BackfillRepoLocStatsInput,
  ): Promise<void> {
    if (!jobId) return;
    await this.queue.saveArgs(jobId, args);
  }

  private async enqueueAnalyze(
    repositoryId: string,
    sinceISO: string,
    organizationId: string | undefined,
    id: string,
  ): Promise<void> {
    await this.queue.enqueue(
      JOB.analyzeRepo,
      {
        repositoryId,
        sinceISO,
        force: false,
        organizationId,
      } satisfies AnalyzeRepoInput,
      { id, phase: 'analyzing', organizationId },
    );
  }
}
