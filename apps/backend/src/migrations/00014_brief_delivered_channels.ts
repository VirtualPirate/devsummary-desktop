import { Kysely, sql } from 'kysely';

/**
 * `briefs.briefs.delivered_channels` — which channels this brief actually went
 * out on.
 *
 * `status = 'delivered'` is a whole-brief verdict: one succeeding channel sets
 * it. The manual re-delivery buttons were reading that verdict per channel, so
 * posting a never-delivered brief to Slack marked it delivered and the email
 * button disappeared with no email ever sent. `failure_reason` cannot answer it
 * either — it records channels that *failed*, and a channel that was never
 * attempted leaves nothing behind.
 *
 * Existing rows keep the `'{}'` default: there are no production installs yet,
 * so the only cost is that a brief delivered before this column existed offers
 * its buttons again.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's
 * CamelCasePlugin is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .addColumn('delivered_channels', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::text[]`),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('briefs')
    .alterTable('briefs')
    .dropColumn('delivered_channels')
    .execute();
}
