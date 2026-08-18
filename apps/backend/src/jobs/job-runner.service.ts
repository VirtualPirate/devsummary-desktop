import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import {
  KYSELY_DB,
  type AppDatabase,
  type JobSelect,
} from '../databases/kysely';
import { JobHandlerRegistry } from './job-handlers';
import { JobQueueService } from './job-queue.service';
import { backoffMs, profileFor } from './job-profiles';

/** How long an idle loop waits before polling again. */
const IDLE_MS = 1_000;

/**
 * Two loops, not one: a brief generation waiting on OpenAI must not stop a
 * commit ingest from starting. Not more than two, because every query goes
 * through PGlite's single connection anyway and the fan-out inside
 * `analysis.analyzeRepo` is the real concurrency knob.
 */
const LOOPS = 2;

@Injectable()
export class JobRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobRunnerService.name);
  private stopped = false;

  constructor(
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
    private readonly handlers: JobHandlerRegistry,
    private readonly queue: JobQueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverRunning();
    for (let i = 0; i < LOOPS; i++) void this.loop();
  }

  onModuleDestroy(): void {
    this.stopped = true;
  }

  /**
   * Crash recovery. Anything left `running` belonged to the process that died,
   * so it goes back on the queue — but **`attempts` is not reset**: it was
   * incremented at claim time, so a job that kills the process still burns its
   * budget instead of looping forever.
   */
  async recoverRunning(): Promise<number> {
    const res = await this.db
      .updateTable('jobs')
      .set({ state: 'pending' })
      .where('state', '=', 'running')
      .executeTakeFirst();
    const count = Number(res.numUpdatedRows ?? 0);
    if (count > 0) this.logger.log(`requeued ${count} job(s) left running`);
    return count;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const worked = await this.runOnce().catch((err) => {
        // The loop itself must never die — a broken claim query would otherwise
        // silently stop all background work for the life of the process.
        this.logger.error(`job loop error: ${describe(err)}`);
        return false;
      });
      if (!worked) await sleep(IDLE_MS);
    }
  }

  /**
   * Claim and run at most one job. Returns false when there was nothing to do.
   *
   * The claim is a single statement, so it is atomic without a transaction —
   * which matters on PGlite, where a transaction holds the one connection for
   * its whole lifetime and would block the other loop and every HTTP request.
   */
  async runOnce(): Promise<boolean> {
    const claimed = await sql<JobSelect>`
      update public.jobs set state = 'running', attempts = attempts + 1
      where id = (
        select id from public.jobs
        where state = 'pending' and run_at <= now()
        order by run_at
        limit 1
      )
      returning *`.execute(this.db);

    const job = claimed.rows[0];
    if (!job) return false;

    if (this.queue.isAborted(job.organizationId)) {
      // Its workspace is being deleted; the rows this job would write are on
      // their way out.
      await this.remove(job.id);
      return true;
    }

    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.fail(job, new Error(`no handler for job type '${job.type}'`), {
        terminal: true,
      });
      return true;
    }

    try {
      await handler(job.args, job);
      await this.remove(job.id);
    } catch (err) {
      await this.fail(job, err);
    }
    return true;
  }

  private async remove(id: string): Promise<void> {
    await this.db.deleteFrom('jobs').where('id', '=', id).execute();
  }

  private async fail(
    job: JobSelect,
    err: unknown,
    opts: { terminal?: boolean } = {},
  ): Promise<void> {
    const message = describe(err);
    const dead =
      opts.terminal || job.attempts >= profileFor(job.type).maxAttempts;

    await this.db
      .updateTable('jobs')
      .set({
        state: dead ? 'failed' : 'pending',
        error: message,
        runAt: new Date(Date.now() + backoffMs(job.type, job.attempts)),
      })
      .where('id', '=', job.id)
      .execute();

    const label = `job ${job.id} attempt ${job.attempts}/${job.maxAttempts}`;
    if (dead) this.logger.error(`${label} failed permanently: ${message}`);
    else this.logger.warn(`${label} failed, retrying: ${message}`);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // unref: a pending poll delay must not hold the process open on shutdown.
    setTimeout(resolve, ms).unref();
  });
}
