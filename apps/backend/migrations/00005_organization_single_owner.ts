import { Kysely, sql } from 'kysely';

/**
 * Enforce one owner row per organization.
 *
 * `organization_members` was unique only on (organization_id, user_id), so
 * nothing at the schema level stopped an org ending up with two `owner` rows —
 * which two concurrent ownership transfers could produce. The extra owner is
 * unrecoverable through the API: it cannot be demoted, removed, or made to
 * leave. The application now takes a row lock on the organization before it
 * reads memberships; this index is the durable backstop under it.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's CamelCasePlugin
 * is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  // Fail loudly with the offending orgs named, rather than aborting on an
  // opaque Postgres unique-violation with no way to see which orgs to fix.
  const duplicates = await sql<{ organization_id: string; owners: number }>`
    select organization_id, count(*)::int as owners
    from organization_members
    where role = 'owner'
    group by organization_id
    having count(*) > 1
    order by count(*) desc
  `.execute(db);

  if (duplicates.rows.length > 0) {
    const detail = duplicates.rows
      .map((r) => `${r.organization_id} (${r.owners} owners)`)
      .join(', ');
    throw new Error(
      `Cannot create organization_members_single_owner_unique: these organizations have more than one owner row — ${detail}. ` +
        'Demote the extra owners to admin before applying this migration.',
    );
  }

  await db.schema
    .createIndex('organization_members_single_owner_unique')
    .ifNotExists()
    .unique()
    .on('organization_members')
    .column('organization_id')
    .where(sql<boolean>`role = 'owner'`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('organization_members_single_owner_unique')
    .ifExists()
    .execute();
}
