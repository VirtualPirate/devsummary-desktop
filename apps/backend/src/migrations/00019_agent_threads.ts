import { Kysely, sql } from 'kysely';

/**
 * The agent's thread id is now the row's own uuid.
 *
 * `sessions.opencode_session_id` existed because the thread lived in a separate
 * OpenCode process and had an id we did not choose; a proxy joined on it to
 * authorize an inbound path segment. The agent now runs in this process against
 * a LangGraph checkpointer keyed by whatever thread id we hand it, and that is
 * `sessions.id`.
 *
 * The checkpointer's own tables (`checkpoints`, `checkpoint_writes`,
 * `checkpoint_blobs`, `checkpoint_migrations`) are created in this same schema by
 * `PostgresSaver.setup()` on first use, not here: it runs its own migrations and
 * a hand-written copy of them would be a second source of truth for a shape that
 * belongs to the library.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('agents')
    .alterTable('sessions')
    .dropColumn('opencode_session_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('agents')
    .alterTable('sessions')
    .addColumn('opencode_session_id', 'text', (col) =>
      // Not null in the original, but existing rows have no value to put here.
      col.unique(),
    )
    .execute();
  await sql`select 1`.execute(db);
}
