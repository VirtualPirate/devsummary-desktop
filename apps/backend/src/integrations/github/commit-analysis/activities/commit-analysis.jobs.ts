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
    this.registry.register(JOB.analyzeRepo, (args) =>
      this.analyzeRepo(args as unknown as AnalyzeRepoInput),
    );
    this.registry.register(JOB.sweepRepositories, (args) => this.sweep(args));
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
    this.registry.register(JOB.backfillRepoLocStats, (args) =>
      this.backfillRepoLocStats(args as unknown as BackfillRepoLocStatsInput),
    );
  }

  async analyzeRepo(input: AnalyzeRepoInput): Promise<void> {
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

      for (let i = 0; i < planned.commitIds.length; i += BATCH) {
        const batch = planned.commitIds.slice(i, i + BATCH);
        // allSettled (not all): a single commit exhausting its retries must not
        // abort the rest of the batch, the page, or the pages after it — the
        // per-commit failure is already persisted by `recordFailed` before it
        // throws, so nothing is silently lost here.
        await Promise.allSettled(
          batch.map((commitId) => this.commits.analyzeCommit({ commitId })),
        );
      }

      cursor = planned.nextCursor;
    } while (cursor);
  }

  async sweep(input: SweepRepositoriesInput = {}): Promise<void> {
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

  async backfillRepoLocStats(input: BackfillRepoLocStatsInput): Promise<void> {
    let cursor = input.cursor;
    for (;;) {
      const { nextCursor } = await this.loc.pageRepo({
        repositoryId: input.repositoryId,
        cursor,
      });
      if (nextCursor === null) return;
      cursor = nextCursor;
      this.logger.debug(`[loc.backfillRepo] ${input.repositoryId} next page`);
      await sleep(LOC_PAGE_DELAY_MS);
    }
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
