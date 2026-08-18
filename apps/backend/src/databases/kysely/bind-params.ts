/**
 * Postgres sends the bind-parameter count as an int16, so a single statement
 * carries at most 65535 of them. Past that the count wraps and the server
 * reports a mismatch that names neither the table nor the real cause:
 * `bind message has 2625 parameter formats but 0 parameters`.
 *
 * Every statement whose parameter count grows with repository size — a
 * multi-row insert, an `IN` list built from a previous query — has to be split.
 * `docs/scale-ceilings.md` tracks the ones that do.
 */
export const PG_MAX_BIND_PARAMS = 65535;

/**
 * Rows per statement. Deliberately one fixed conservative number rather than a
 * per-call-site parameter count: at 1000 rows a statement stays under the cap
 * for any row binding up to 65 columns, so adding a column to a table can never
 * silently push a caller over. An `IN` list (one parameter per item) is nowhere
 * near the cap at this size — the extra round trips are not worth a second knob.
 */
export const DB_BATCH_ROWS = 1000;

export function chunk<T>(items: T[], size: number = DB_BATCH_ROWS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
