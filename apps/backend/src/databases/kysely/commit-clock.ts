import { sql, type RawBuilder } from 'kysely';
import type { BriefCommitClock } from './database.types';

/**
 * Resolves a brief's `commitClock` to the `github.commits` timestamp column its
 * period is bounded by.
 *
 * **The clock never reaches SQL as a string.** Both lookups are closed switches
 * over the union that return a fixed identifier and throw on anything else, so
 * a junk value read out of a hand-edited row (or a future enum member nobody
 * wired up) fails loudly instead of composing SQL or, worse, silently selecting
 * on a column that does not exist.
 */
function unknownClock(clock: never): never {
  throw new Error(`unknown commit clock: ${JSON.stringify(clock)}`);
}

/**
 * The camelCase column name, for Kysely query-builder call sites —
 * `CamelCasePlugin` maps it to `authored_at` / `committed_at`.
 */
export function commitClockColumn(
  clock: BriefCommitClock,
): 'authoredAt' | 'committedAt' {
  switch (clock) {
    case 'authored':
      return 'authoredAt';
    case 'committed':
      return 'committedAt';
    default:
      return unknownClock(clock);
  }
}

/**
 * The same column as a quoted reference on the `c` alias, for the raw
 * template-literal queries in `BriefReportRepository`. Written snake_case
 * because those queries are raw SQL; it is also a fixpoint of
 * `CamelCasePlugin`'s mapper, so it survives the plugin unchanged either way.
 */
export function commitClockRef(clock: BriefCommitClock): RawBuilder<Date> {
  switch (clock) {
    case 'authored':
      return sql.ref('c.authored_at');
    case 'committed':
      return sql.ref('c.committed_at');
    default:
      return unknownClock(clock);
  }
}
