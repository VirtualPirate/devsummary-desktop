import { Kysely, sql } from 'kysely';

/**
 * `briefs.briefs.highlights` — the structured highlight list the brief LLM
 * call now returns alongside title and summary. Defaults to an empty array so
 * every brief generated before this migration reads back as "no highlights"
 * rather than null, and the response mapper needs no null branch.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's
 * CamelCasePlugin is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .addColumn('highlights', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .dropColumn('highlights')
    .execute();
}
