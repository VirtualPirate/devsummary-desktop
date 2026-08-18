import { Kysely, sql } from 'kysely';

/**
 * `briefs.briefs.period_end` becomes **exclusive**.
 *
 * It was an inclusive `23:59:59.999` local, which does not tile: on a 25-hour
 * DST fall-back day the repeated hour sat between one window's end and the next
 * window's start and landed in no brief at all. Half-open periods
 * (`period_start <= authored_at < period_end`, `period_end` = the next local
 * midnight) tile exactly, and match the analytics queries, which were already
 * `>= from` / `< to`.
 *
 * `+ 1 millisecond` is the conversion, and it is exact for every scheduled row
 * except one whose period ended on a day that falls BACK at local midnight.
 * Measured against the recomputed boundary over 418 IANA zones × 366 days:
 * 152,985 of 152,988 zone-days convert exactly. The 3 that do not — Santiago
 * (2026-04-04), Godthab and Scoresbysund (2026-10-24) — come out an hour short,
 * because on those days local midnight happens twice and the old inclusive end
 * sat at the first one while the period truly runs to the second. That is
 * exactly the hour this whole change exists to recover, so those rows keep a
 * report window an hour shy of the commits their brief already counted.
 *
 * Re-deriving them per row would need the brief's zone and the cadence
 * primitives inside a migration — the application code migrations deliberately
 * do not import — to move an hour of report window on at most a few historical
 * rows whose commit set is already frozen in `brief_commits`.
 *
 * On-demand briefs need no special case: their `period_end` is an arbitrary
 * user-picked instant, not a local midnight, and widening one by a millisecond
 * is harmless — the commit query goes from `<= t` to `< t + 1ms`, which selects
 * the same rows unless a commit was authored inside that millisecond.
 *
 * No index or constraint is at risk. `period_end` appears only in the
 * non-unique `briefs_organization_period_end_idx`; the one unique index on this
 * table, `briefs_schedule_period_active_unique`, is
 * `(brief_schedule_id, period_start)` and is untouched. A uniform shift is
 * order-preserving and injective, so it cannot collide with anything anyway.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's
 * CamelCasePlugin is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    update briefs.briefs
    set period_end = period_end + interval '1 millisecond'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    update briefs.briefs
    set period_end = period_end - interval '1 millisecond'
  `.execute(db);
}
