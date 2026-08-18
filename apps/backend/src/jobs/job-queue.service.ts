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
}

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
      // ponytail: re-arm resets attempts=0, so a deterministically failing handler behind a
      // recurring stable id (e.g. sweep:<repoId>:<branch>:<date>, re-enqueued every 15 min)
      // re-burns its full retry budget each cycle — up to ~380 GitHub calls/day against the
      // user's own PAT. Ceiling if it bites: skip the re-arm when the failed row's run_at is
      // younger than the scheduler tick interval.
      .onConflict((c) =>
        c
          .column('id')
          .doUpdateSet({ state: 'pending', attempts: 0, error: null, runAt })
          // Only a *terminally failed* row is re-armed; pending and running
          // still no-op, which is the dedup this whole method exists for.
          // Without it a dead row holds its id forever, and every stable id
          // here is derived from state rather than time: a failed
          // `sweep:<repo>:<branch>:<runDate>` blocks that repository's ingest
          // until the next runDate, a failed `brief:<id>` makes
          // `reapStalePending` a silent no-op, and a failed `sweep:<date>`
          // kills the day's polling outright. A fresh enqueue is a fresh
          // request, so it also restarts the attempt budget.
          .where('jobs.state', '=', 'failed'),
      )
      .execute();
    return id;
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
