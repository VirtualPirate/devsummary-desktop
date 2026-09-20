import { Kysely, sql } from 'kysely';

/**
 * `agents` schema: chat threads with the workspace's agent, and their token
 * accounting.
 *
 * Its own schema rather than `briefs`: nothing in the brief pipeline references
 * these rows, and the agent is a separate product surface. The LangGraph
 * checkpointer's own tables land in this schema too, created by
 * `PostgresSaver.setup()` on first use rather than here — see `00019`.
 *
 * `sessions.opencode_session_id` is the upstream cloud shape, where the thread
 * lived in a separate OpenCode process whose id the proxy joined on. It is
 * dropped again in `00019`; the pair is kept as two files so this chain stays
 * comparable with the one it was ported from.
 *
 * A `usage` row is inserted *before* the model runs, so a run that dies halfway
 * still leaves a record; `prompt_tokens` / `completion_tokens` stay null in that
 * case. The cloud original also counted these rows against a per-tenant daily
 * cap — there is no cap on a single-user desktop install, so they are token
 * accounting only.
 *
 * Migrations are intentionally independent of application code. They use only
 * `kysely` imports and literal snake_case identifiers (the app's CamelCasePlugin
 * is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('agents').execute();

  await db.schema
    .withSchema('agents')
    .createTable('sessions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) => col.notNull())
    // `auth.user.id` is text, not uuid — it held a Better Auth nanoid before the
    // desktop port seeded one fixed row into it.
    .addColumn('created_by', 'text', (col) =>
      col.notNull().references('auth.user.id').onDelete('cascade'),
    )
    .addColumn('opencode_session_id', 'text', (col) => col.notNull().unique())
    .addColumn('title', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('agents')
    .createIndex('sessions_org_updated_idx')
    .on('sessions')
    .columns(['organization_id', 'updated_at desc'])
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();

  await db.schema
    .withSchema('agents')
    .createTable('usage')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('organization_id', 'uuid', (col) => col.notNull())
    .addColumn('session_id', 'uuid', (col) =>
      col.notNull().references('agents.sessions.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'text', (col) =>
      col.notNull().references('auth.user.id').onDelete('cascade'),
    )
    .addColumn('model', 'text', (col) => col.notNull())
    .addColumn('prompt_tokens', 'integer')
    .addColumn('completion_tokens', 'integer')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .withSchema('agents')
    .createIndex('usage_org_created_idx')
    .on('usage')
    .columns(['organization_id', 'created_at'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.withSchema('agents').dropTable('usage').execute();
  await db.schema.withSchema('agents').dropTable('sessions').execute();
  await db.schema.dropSchema('agents').execute();
}
