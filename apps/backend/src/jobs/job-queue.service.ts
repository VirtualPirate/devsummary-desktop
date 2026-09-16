import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB, type AppDatabase } from '../databases/kysely';
import { type Phase, profileFor } from './job-profiles';

export interface EnqueueOpts {
  /** Stable dedup key. Defaults to `<type>:<uuid>`, i.e. never deduped. */
  id?: string;
  phase?: Phase;
  organizationId?: string;
  /** Postpone the first attempt (the old `startDelay`). */
  delayMs?: number;
  /**
   * A person pressed a button. Re-arms a terminally failed row immediately
   * instead of waiting out `REARM_COOLDOWN_MS`. Automatic callers — schedulers,
   * fan-outs, reapers — must not set this: they are the ones the cooldown
   * exists for.
   */
  force?: boolean;
}

/**
 * How long a terminally failed row keeps its id before an *automatic* enqueue
 * may re-arm it.
 *
 * The re-arm resets `attempts` to 0, so without a cooldown a deterministically
 * failing handler behind a recurring stable id re-burns its whole retry budget
 * every tick: `sweep:<repo>:<branch>:<date>` is re-enqueued every 15 minutes
 * and costs 4 attempts each time (~380 GitHub calls/day against the user's own
 * PAT), and `brief:<id>` is re-dispatched by `reapStalePending` every minute at
 * an LLM call per attempt. One hour caps both at one budget per hour while
 * still clearing the id, which is what the re-arm is for.
 */
const REARM_COOLDOWN_MS = 60 * 60_000;

@Injectable()
export class JobQueueService {
  /**
   * Organizations whose deletion is in flight. A handler that loops (sweeps,
   * fan-outs) checks this and bails rather than writing rows into a workspace
   * that is being torn down.
   *
   * ponytail: never pruned — one entry per org deleted per process lifetime, on
   * a single-user desktop. Prune it the day teardown runs in a loop.
   */
  private readonly aborted = new Set<string>();

  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  /**
   * `on conflict` on a stable id is exactly what Temporal's `USE_EXISTING`
   * conflict policy did: a second enqueue while the first is still pending or
   * running is a no-op. The row is deleted on success, so the id frees up as
   * soon as the work is done — which is what makes `dispatch:<minute>` and
   * `sweep:<date>` behave like `ScheduleOverlapPolicy.SKIP` rather than a
   * one-shot lock. A row that failed terminally is the one case that is *not*
   * a no-op: see the `where` below.
   */
  async enqueue(
    type: string,
    args: unknown = {},
    opts: EnqueueOpts = {},
  ): Promise<string> {
    const id = opts.id ?? `${type}:${randomUUID()}`;
    const runAt = new Date(Date.now() + (opts.delayMs ?? 0));
    await this.db
      .insertInto('jobs')
      .values({
        id,
        type,
        // `args` is a jsonb column typed `Json<>`: writes are strings, reads are
        // parsed values. Handing it an object lands `[object Object]`.
        args: JSON.stringify(args ?? {}),
        phase: opts.phase ?? null,
        organizationId: opts.organizationId ?? null,
        maxAttempts: profileFor(type).maxAttempts,
        runAt,
      })
      .onConflict((c) => {
        const rearm = c
          .column('id')
          // `args` too: a checkpointed cursor belongs to the run that died,
          // and this is a new request with its own window.
          .doUpdateSet({
            state: 'pending',
            attempts: 0,
            error: null,
            runAt,
            args: JSON.stringify(args ?? {}),
          })
          // Only a *terminally failed* row is re-armed; pending and running
          // still no-op, which is the dedup this whole method exists for.
          // Without it a dead row holds its id forever, and every stable id
          // here is derived from state rather than time: a failed
          // `sweep:<repo>:<branch>:<runDate>` blocks that repository's ingest
          // until the next runDate, a failed `brief:<id>` makes
          // `reapStalePending` a silent no-op, and a failed `sweep:<date>`
          // kills the day's polling outright. A fresh enqueue is a fresh
          // request, so it also restarts the attempt budget.
          .where('jobs.state', '=', 'failed');
        if (opts.force) return rearm;
        // `run_at` on a failed row is the moment its last attempt was given up
        // on (fail time plus the final backoff), so it is already the cooldown
        // clock — no extra column. A no-op here leaves the row `failed`, which
        // is what the UI reads to show the failure.
        return rearm.where(
          'jobs.runAt',
          '<=',
          new Date(Date.now() - REARM_COOLDOWN_MS),
        );
      })
      .execute();
    return id;
  }

  /**
   * A running handler's resume point, written back onto its own row.
   *
   * A retry re-invokes the handler with whatever `args` the row holds, so a
   * paging loop that never writes its cursor back starts again at page 1 — on
   * a sweep that is every repository re-ingested, on `analyzeRepo` every page
   * re-planned. Called at a page boundary, this makes a retry cost one page.
   *
   * Not an upsert: the row is `running` (the runner claimed it) or already
   * gone, and a checkpoint for a job nobody will retry is a no-op either way.
   */
  async saveArgs(jobId: string, args: unknown): Promise<void> {
    await this.db
      .updateTable('jobs')
      .set({ args: JSON.stringify(args ?? {}) })
      .where('id', '=', jobId)
      .execute();
  }

  /** Drops every job for an org that has not started, and flags the rest. */
  async abortOrganization(organizationId: string): Promise<number> {
    this.aborted.add(organizationId);
    const res = await this.db
      .deleteFrom('jobs')
      .where('organizationId', '=', organizationId)
      .where('state', '<>', 'running')
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0);
  }

  /** Read by long-running handlers so they stop mid-flight. */
  isAborted(organizationId: string | null | undefined): boolean {
    return !!organizationId && this.aborted.has(organizationId);
  }
}
