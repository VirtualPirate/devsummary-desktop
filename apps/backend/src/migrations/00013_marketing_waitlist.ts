import { Kysely, sql } from 'kysely';

/**
 * `marketing.waitlist` — pre-launch signups from the marketing site.
 *
 * Its own schema rather than `public`: this is the first table that belongs to
 * the marketing site rather than to the product, and nothing in the app domain
 * references it.
 *
 * The unique index on `email` is the dedupe — a repeat signup is an
 * `ON CONFLICT DO NOTHING`, not an application-level read-then-write, which two
 * concurrent submissions of the same address would lose. Emails are normalized
 * (trimmed, lowercased) by the request schema before they get here, so the
 * index does not need `lower(email)`.
 *
 * No `updated_at` or `deleted_at`: a row is written once and never edited.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's
 * CamelCasePlugin is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('marketing').execute();

  await db.schema
    .withSchema('marketing')
    .createTable('waitlist')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.withSchema('marketing').dropTable('waitlist').execute();
  await db.schema.dropSchema('marketing').execute();
}
