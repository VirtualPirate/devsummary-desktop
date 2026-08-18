import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { JOB } from './job-profiles';
import { JobQueueService } from './job-queue.service';

const DISPATCH_INTERVAL_MS = 60_000;
const SWEEP_INTERVAL_MS = 15 * 60_000;

/**
 * Replaces the two Temporal Schedules. Both enqueues are deduped on an id
 * derived from the clock, which is what `ScheduleOverlapPolicy.SKIP` bought:
 * while a run is still pending or running its id is taken, and the row is
 * deleted the moment it succeeds, so the next tick starts a fresh one.
 *
 * Neither is catch-up machinery. `briefs.claimDue` claims on `nextRunAt <= now`
 * and the sweep re-derives its window from what is stored, so a laptop closed
 * for a week resolves on the next launch by running once, not 10,080 times.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(private readonly queue: JobQueueService) {}

  onModuleInit(): void {
    // On boot, not on the first interval: a desktop app is launched *because*
    // the user wants current data, and 15 minutes of nothing looks broken.
    void this.sweep();
    this.every(DISPATCH_INTERVAL_MS, () => this.dispatchDueBriefs());
    this.every(SWEEP_INTERVAL_MS, () => this.sweep());
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
  }

  private every(ms: number, run: () => Promise<unknown>): void {
    const timer = setInterval(() => {
      void run().catch((err: unknown) => {
        this.logger.warn(
          `scheduler tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, ms);
    // unref: the scheduler must not be the reason the process stays alive.
    timer.unref();
    this.timers.push(timer);
  }

  /** id `dispatch:<YYYY-MM-DDTHH:mm>` — one dispatch per minute, ever. */
  private async dispatchDueBriefs(): Promise<void> {
    await this.queue.enqueue(
      JOB.dispatchDueBriefs,
      {},
      { id: `dispatch:${new Date().toISOString().slice(0, 16)}` },
    );
  }

  /** id `sweep:<YYYY-MM-DD>` — the old `github-sweep-daily` overlap policy. */
  private async sweep(): Promise<void> {
    await this.queue.enqueue(
      JOB.sweepRepositories,
      {},
      { id: `sweep:${new Date().toISOString().slice(0, 10)}` },
    );
  }
}
