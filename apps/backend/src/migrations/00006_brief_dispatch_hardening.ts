import { Kysely, sql } from 'kysely';

/**
 * Hardening for the recurring brief dispatcher.
 *
 * 1. `brief_schedules.dispatch_failure_count` / `dispatch_failure_reason` — a
 *    schedule that fails to dispatch now retries on the next tick (each claim
 *    runs in its own transaction), so a permanently broken one would sit at the
 *    head of the `next_run_at ASC` window forever and starve every healthy
 *    schedule. The counter escalates to `paused = true`, which also makes the
 *    breakage visible in the UI. Reset to 0 on a successful dispatch.
 * 2. A partial unique index on `(brief_schedule_id, period_start)` for live
 *    briefs — two dispatchers claiming the same period is now a 23505 the claim
 *    path treats as "already claimed", instead of two briefs for one period.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's CamelCasePlugin
 * is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  // The unique index below cannot be created while duplicates exist. Fail with
  // the offending pairs rather than a bare Postgres error, since the operator
  // has to reconcile them (soft-delete the extras) before this can apply.
  const duplicates = await sql<{
    brief_schedule_id: string;
    period_start: Date;
    count: number;
  }>`
    select brief_schedule_id, period_start, count(*)::int as count
    from briefs.briefs
    where deleted_at is null and brief_schedule_id is not null
    group by brief_schedule_id, period_start
    having count(*) > 1
    order by count(*) desc
    limit 20
  `.execute(db);

  if (duplicates.rows.length > 0) {
    const listed = duplicates.rows
      .map(
        (r) =>
          `${r.brief_schedule_id} @ ${new Date(r.period_start).toISOString()} (${r.count})`,
      )
      .join(', ');
    throw new Error(
      `Cannot create briefs_schedule_period_active_unique: duplicate live briefs exist for the same schedule + period. Soft-delete the extras first. Offenders (up to 20): ${listed}`,
    );
  }

  await sql`
    alter table briefs.brief_schedules
      add column if not exists dispatch_failure_count integer not null default 0,
      add column if not exists dispatch_failure_reason text
  `.execute(db);

  await db.schema
    .withSchema('briefs')
    .createIndex('briefs_schedule_period_active_unique')
    .ifNotExists()
    .unique()
    .on('briefs')
    .columns(['brief_schedule_id', 'period_start'])
    .where(sql<boolean>`deleted_at IS NULL`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('briefs')
    .dropIndex('briefs_schedule_period_active_unique')
    .ifExists()
    .execute();

  await sql`
    alter table briefs.brief_schedules
      drop column if exists dispatch_failure_count,
      drop column if exists dispatch_failure_reason
  `.execute(db);
}
