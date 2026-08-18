import { Kysely, sql } from 'kysely';

/**
 * Promote the Slack workspace id to a real column on `slack.installations`.
 *
 * `team_id` previously lived only inside the jsonb `raw`, so nothing could ask
 * "is this workspace still connected to another organization?" — and disconnect
 * revoked a bot token several orgs might share. The column stays **nullable and
 * non-unique**: one workspace connected to many orgs is legal, and rows written
 * before this migration may have no usable team id.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's CamelCasePlugin
 * is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('slack')
    .alterTable('installations')
    .addColumn('team_id', 'text')
    .execute();

  // `raw` is written as `{ teamId, teamName, …, oauthResponse }` (camelCase keys
  // inside the JSON document); `oauthResponse` is Slack's untouched
  // `oauth.v2.access` body, whose team id is `team.id` — used as a fallback for
  // any row whose top-level `teamId` is missing.
  await sql`
    UPDATE slack.installations
    SET team_id = COALESCE(
      raw ->> 'teamId',
      raw -> 'oauthResponse' -> 'team' ->> 'id'
    )
    WHERE team_id IS NULL
  `.execute(db);

  await db.schema
    .withSchema('slack')
    .createIndex('slack_installations_team_id_idx')
    .on('installations')
    .column('team_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('slack')
    .dropIndex('slack_installations_team_id_idx')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('slack')
    .alterTable('installations')
    .dropColumn('team_id')
    .execute();
}
