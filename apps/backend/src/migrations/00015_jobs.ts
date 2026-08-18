import { Kysely, sql } from 'kysely';

/**
 * `jobs` — the local replacement for Temporal (plan D2).
 *
 * The primary key *is* the dedup key: an `insert ... on conflict do nothing` on
 * a stable id is exactly Temporal's `USE_EXISTING` / `ScheduleOverlapPolicy.SKIP`.
 *
 * `local_settings` is a single key/value table for machine-local state that has
 * no organization (e.g. `last_sweep_at`).
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's
 * CamelCasePlugin is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('jobs')
    .addColumn('id', 'text', (c) => c.primaryKey()) // stable id == dedup key
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('args', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('phase', 'text') // fetching|analyzing|generating
    .addColumn('organization_id', 'uuid')
    .addColumn('state', 'text', (c) => c.notNull().defaultTo('pending'))
    .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('max_attempts', 'integer', (c) => c.notNull().defaultTo(4))
    .addColumn('run_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn('created_at', 'timestamptz', (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn('error', 'text')
    .execute();

  // The claim query's only hot path.
  await sql`create index jobs_claim_idx on public.jobs (run_at) where state = 'pending'`.execute(
    db,
  );
  await sql`create index jobs_phase_idx on public.jobs (phase) where state = 'running'`.execute(
    db,
  );

  await db.schema
    .createTable('local_settings')
    .addColumn('key', 'text', (c) => c.primaryKey())
    .addColumn('value', 'jsonb', (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('local_settings').execute();
  await db.schema.dropTable('jobs').execute();
}
