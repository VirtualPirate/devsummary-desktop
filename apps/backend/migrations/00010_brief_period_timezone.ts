import { Kysely } from 'kysely';

/**
 * `briefs.briefs.period_timezone` — the timezone `period_start`/`period_end`
 * were computed in, snapshotted on the brief at creation.
 *
 * The report used to look the zone up on the live `brief_schedules` row on
 * every read, so editing a schedule's timezone silently re-tiled every
 * historical brief: the first and last day columns went partial and
 * `sum(dailyRows)` stopped matching the stored `commit_count`.
 *
 * Existing rows default to `'UTC'` deliberately — that is exactly what the old
 * `formatPeriodLabel(period, 'UTC')` and the report's UTC fallback already did
 * for a brief with no schedule, so already-generated briefs keep the labels and
 * day columns they have today rather than shifting on deploy.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's
 * CamelCasePlugin is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .addColumn('period_timezone', 'text', (col) =>
      col.notNull().defaultTo('UTC'),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .dropColumn('period_timezone')
    .execute();
}
