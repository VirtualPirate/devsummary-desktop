import { Kysely, sql } from 'kysely';

/**
 * Free a GitHub installation id once the organization holding it disconnects.
 *
 * `installations_github_installation_id_unique` was global and NOT partial on
 * `deleted_at`, so a soft-deleted row kept the slot forever: after org A
 * disconnected, no other organization — not even another org owned by the same
 * user — could connect that GitHub account again unless GitHub happened to issue
 * a brand-new installation id.
 *
 * The replacement is unique on `github_installation_id` only among live rows, so
 * at most one *active* installation can hold a given id while disconnected rows
 * release it. Sharing one GitHub account across two live orgs stays disallowed —
 * `GithubInstallationsService.handleCallback` rejects that with
 * `GITHUB_INSTALLATION_ALREADY_CONNECTED` (409) before it reaches the index.
 *
 * Mirrors the shape of `slack_installations_org_active_unique` from 00001.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's CamelCasePlugin
 * is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('github')
    .dropIndex('installations_github_installation_id_unique')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('github')
    .createIndex('installations_github_installation_id_active_unique')
    .unique()
    .on('installations')
    .column('github_installation_id')
    .where(sql<boolean>`deleted_at IS NULL`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('github')
    .dropIndex('installations_github_installation_id_active_unique')
    .ifExists()
    .execute();

  // Fails if two rows (live or soft-deleted) share a github_installation_id by
  // this point — i.e. if a second org connected a GitHub account that a first
  // org had disconnected. Those rows must be hard-deleted before rolling back.
  await db.schema
    .withSchema('github')
    .createIndex('installations_github_installation_id_unique')
    .unique()
    .on('installations')
    .column('github_installation_id')
    .execute();
}
