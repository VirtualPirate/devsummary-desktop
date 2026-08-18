import type { Kysely } from 'kysely';
import type { Database } from '../../../src/databases/kysely/database.types';

/**
 * Block until the `jobs` table is empty.
 *
 * The job runner is live in every booted app and polls on a 1 s idle loop, so
 * anything the pipeline enqueues finishes on its own schedule. A `sleep(n)` is
 * the wrong tool twice over: too short and the assertion races the runner, too
 * long and every spec pays for the worst case.
 *
 * A succeeded job is **deleted** by the runner, so "empty" is the drain signal.
 * A job that exhausted its attempts stays behind as `failed`, and one still
 * retrying stays `pending` with a `run_at` in the future — both would otherwise
 * show up only as a timeout, so the error names the row and its reason.
 */
export async function waitForJobs(
  db: Kysely<Database>,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const rows = await db
      .selectFrom('jobs')
      .select(['id', 'type', 'state', 'attempts', 'error'])
      .execute();
    if (rows.length === 0) return;

    const dead = rows.find((r) => r.state === 'failed');
    if (dead) {
      throw new Error(
        `job ${dead.type} failed after ${dead.attempts} attempt(s): ${dead.error ?? 'no error recorded'}`,
      );
    }

    if (Date.now() > deadline) {
      const pending = rows
        .map(
          (r) =>
            `${r.type}(${r.state}, attempts=${r.attempts}, err=${r.error ?? '-'})`,
        )
        .join(', ');
      throw new Error(`jobs did not drain within ${timeoutMs}ms: ${pending}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
