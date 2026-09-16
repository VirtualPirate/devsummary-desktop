import { Logger } from '@nestjs/common';
import type { AppDatabase } from '../../databases/kysely';
import { JobHandlerRegistry } from '../job-handlers';
import { JobQueueService } from '../job-queue.service';
import { JobRunnerService } from '../job-runner.service';
import { createJobsDb } from './jobs-test-db';

jest.setTimeout(30_000);

const TYPE = 'briefs.generate'; // profile `standard`: 4 attempts, 30s, ×2
const CLOCK = new Date('2026-08-19T09:00:00.000Z');

let db: AppDatabase;
let queue: JobQueueService;
let registry: JobHandlerRegistry;
let runner: JobRunnerService;

beforeAll(async () => {
  db = await createJobsDb();
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await db.deleteFrom('jobs').execute();
  registry = new JobHandlerRegistry();
  queue = new JobQueueService(db);
  runner = new JobRunnerService(db, registry, queue);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const row = (id: string) =>
  db.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirst();

/**
 * Freeze `Date` only, leaving the timer functions real because PGlite's WASM
 * runtime schedules on them.
 *
 * Postgres' `now()` is fakeable here: PGlite runs in-process and reads the host
 * clock per statement, so the claim predicate `run_at <= now()` moves with
 * `jest.setSystemTime`. That is what makes a 30s/60s/120s backoff testable in
 * milliseconds — and what lets the test prove the job is *not* claimable one
 * second early.
 */
function freezeClock(): void {
  jest.useFakeTimers({
    doNotFake: [
      'setTimeout',
      'setInterval',
      'setImmediate',
      'clearTimeout',
      'clearInterval',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'hrtime',
    ],
    now: CLOCK,
  });
}

describe('retry and backoff', () => {
  it('retries a throwing handler on 30s/60s/120s and then fails it', async () => {
    freezeClock();
    const handler = jest.fn(() => Promise.reject(new Error('openai 503')));
    registry.register(TYPE, handler);
    const id = await queue.enqueue(TYPE, { briefId: 'b1' });

    const delays: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      expect(await runner.runOnce()).toBe(true);
      const job = await row(id);
      expect(job!.attempts).toBe(attempt);
      if (attempt === 4) break;

      delays.push(job!.runAt.getTime() - Date.now());
      // One second short of the backoff the job must still be invisible,
      // otherwise the delay is decorative.
      jest.setSystemTime(job!.runAt.getTime() - 1_000);
      expect(await runner.runOnce()).toBe(false);
      jest.setSystemTime(job!.runAt);
    }

    expect(delays).toEqual([30_000, 60_000, 120_000]);

    const finished = await row(id);
    expect(handler).toHaveBeenCalledTimes(4);
    expect(finished!.state).toBe('failed');
    expect(finished!.attempts).toBe(4);
    expect(finished!.error).toBe('openai 503');

    // Dead is dead: a further poll must not pick it back up.
    expect(await runner.runOnce()).toBe(false);
    expect(handler).toHaveBeenCalledTimes(4);
  });

  it('deletes the row and passes parsed args when the handler returns', async () => {
    const seen: unknown[] = [];
    registry.register(TYPE, (args) => {
      seen.push(args);
      return Promise.resolve();
    });
    const id = await queue.enqueue(TYPE, { briefId: 'b1', deliver: true });

    expect(await runner.runOnce()).toBe(true);
    expect(seen).toEqual([{ briefId: 'b1', deliver: true }]);
    expect(await row(id)).toBeUndefined();
  });

  it('fails a job with no registered handler terminally on the first attempt', async () => {
    const id = await queue.enqueue('briefs.gone');

    expect(await runner.runOnce()).toBe(true);
    const job = await row(id);
    expect(job!.state).toBe('failed');
    expect(job!.error).toContain("no handler for job type 'briefs.gone'");
  });

  it('honours the profile: `once` never retries', async () => {
    registry.register('briefs.dispatchDue', () =>
      Promise.reject(new Error('claim raced')),
    );
    const id = await queue.enqueue('briefs.dispatchDue');

    expect(await runner.runOnce()).toBe(true);
    const job = await row(id);
    expect(job!.maxAttempts).toBe(1);
    expect(job!.state).toBe('failed');
  });
});

describe('dedup', () => {
  it('keeps one row when the same id is enqueued twice', async () => {
    await queue.enqueue(
      'github.sweep',
      { page: 1 },
      { id: 'sweep:2026-08-19' },
    );
    await queue.enqueue(
      'github.sweep',
      { page: 2 },
      { id: 'sweep:2026-08-19' },
    );

    const rows = await db.selectFrom('jobs').selectAll().execute();
    expect(rows).toHaveLength(1);
    // First writer wins — the second enqueue is a no-op, not an update.
    expect(rows[0].args).toEqual({ page: 1 });
  });

  /** Fails `id` terminally with `run_at` set `agoMs` in the past. */
  const failRow = async (id: string, agoMs: number) => {
    await db
      .updateTable('jobs')
      .set({
        state: 'failed',
        attempts: 4,
        error: 'boom',
        runAt: new Date(Date.now() - agoMs),
      })
      .where('id', '=', id)
      .execute();
  };

  // A terminally failed row keeps its dedup id forever, and every stable id
  // here is derived from state rather than time: without the re-arm a failed
  // `sweep:<repo>:<branch>:<date>` blocks that repository's ingest until the
  // next runDate, and a failed `brief:<id>` makes the stale-pending reaper a
  // silent no-op.
  it('re-arms a terminally failed row on re-enqueue', async () => {
    const id = 'sweep:r1:main:2026-08-19';
    await queue.enqueue('github.sweep', { page: 1 }, { id });
    await failRow(id, 2 * 60 * 60_000);

    await queue.enqueue('github.sweep', { page: 1 }, { id });

    const job = await row(id);
    expect(job).toMatchObject({ state: 'pending', attempts: 0, error: null });
    // Claimable again, not just relabelled.
    registry.register('github.sweep', () => Promise.resolve());
    expect(await runner.runOnce()).toBe(true);
  });

  // The re-arm resets `attempts` to 0, so without a cooldown the 15-minute
  // sweep hands a deterministically failing handler a fresh budget of 4 every
  // tick — ~380 GitHub calls/day on the user's own PAT.
  it('does not re-arm a row that failed inside the cooldown', async () => {
    const id = 'sweep:r1:main:2026-08-19';
    await queue.enqueue('github.sweep', { page: 1 }, { id });
    await failRow(id, 15 * 60_000);

    await queue.enqueue('github.sweep', { page: 1 }, { id });

    expect(await row(id)).toMatchObject({
      state: 'failed',
      attempts: 4,
      error: 'boom',
    });
  });

  it('re-arms inside the cooldown when the caller forces it', async () => {
    const id = 'analyze:r1:2026-08-19:false';
    await queue.enqueue('analysis.analyzeRepo', { page: 1 }, { id });
    await failRow(id, 15 * 60_000);

    // The manual endpoints pass `force` — a person pressing retry must not wait
    // out a cooldown that exists to throttle the schedulers.
    await queue.enqueue(
      'analysis.analyzeRepo',
      { page: 1 },
      { id, force: true },
    );

    expect(await row(id)).toMatchObject({
      state: 'pending',
      attempts: 0,
      error: null,
    });
  });

  it('still no-ops over a pending or running row', async () => {
    const id = 'sweep:2026-08-19';
    await queue.enqueue('github.sweep', { page: 1 }, { id });
    await db
      .updateTable('jobs')
      .set({ attempts: 2 })
      .where('id', '=', id)
      .execute();

    await queue.enqueue('github.sweep', { page: 9 }, { id });
    expect(await row(id)).toMatchObject({ attempts: 2, state: 'pending' });

    await db
      .updateTable('jobs')
      .set({ state: 'running' })
      .where('id', '=', id)
      .execute();
    await queue.enqueue('github.sweep', { page: 9 }, { id });
    // The whole point of the dedup: a second enqueue must not restart the
    // attempt budget of work that is still in flight.
    expect(await row(id)).toMatchObject({ attempts: 2, state: 'running' });
  });
});

describe('crash recovery', () => {
  it('resets running to pending on boot without resetting attempts', async () => {
    const id = await queue.enqueue(TYPE, {});
    await db
      .updateTable('jobs')
      .set({ state: 'running', attempts: 2 })
      .where('id', '=', id)
      .execute();

    expect(await runner.recoverRunning()).toBe(1);

    const job = await row(id);
    expect(job!.state).toBe('pending');
    // The whole point: a job that kills the process must still exhaust its
    // budget instead of looping forever.
    expect(job!.attempts).toBe(2);
  });

  it('leaves a failed job alone', async () => {
    const id = await queue.enqueue(TYPE, {});
    await db
      .updateTable('jobs')
      .set({ state: 'failed', attempts: 4 })
      .where('id', '=', id)
      .execute();

    expect(await runner.recoverRunning()).toBe(0);
    expect((await row(id))!.state).toBe('failed');
  });
});

describe('claim', () => {
  it('claims one job at a time, oldest run_at first', async () => {
    const order: string[] = [];
    registry.register(TYPE, (_args, job) => {
      order.push(job.id);
      return Promise.resolve();
    });
    await queue.enqueue(TYPE, {}, { id: 'later', delayMs: -1_000 });
    await queue.enqueue(TYPE, {}, { id: 'earlier', delayMs: -5_000 });

    expect(await runner.runOnce()).toBe(true);
    expect(await runner.runOnce()).toBe(true);
    expect(await runner.runOnce()).toBe(false);
    expect(order).toEqual(['earlier', 'later']);
  });

  it('does not claim a job whose run_at is in the future', async () => {
    registry.register(TYPE, () => Promise.resolve());
    await queue.enqueue(TYPE, {}, { delayMs: 60_000 });

    expect(await runner.runOnce()).toBe(false);
  });

  it('drops a claimed job whose organization is being torn down', async () => {
    const handler = jest.fn(() => Promise.resolve());
    registry.register(TYPE, handler);
    const orgId = '3f1a9c62-2c1f-4f2e-9a52-4b1d0d5f8e11';
    const id = await queue.enqueue(TYPE, {}, { organizationId: orgId });
    await queue.abortOrganization(orgId);

    // `abortOrganization` deletes it outright while it is still pending; the
    // claim-time check covers the one that was already running.
    expect(await row(id)).toBeUndefined();

    const running = await queue.enqueue(
      TYPE,
      {},
      { id: 'raced', organizationId: orgId },
    );
    expect(await runner.runOnce()).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(await row(running)).toBeUndefined();
  });
});
