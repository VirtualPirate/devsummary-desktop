import { Kysely, sql } from 'kysely';

/**
 * Allow a user to own more than one organization.
 *
 * `organizations_owner_id_unique` capped every user at a single owned org. It is
 * replaced by a plain (non-unique) index so owner lookups stay cheap.
 *
 * Both directions are idempotent (`ifExists` / `ifNotExists`) so a restored
 * snapshot or a partially-applied earlier attempt does not abort the batch and
 * leave `organizations_owner_id_idx` uncreated.
 *
 * Migrations are intentionally independent of application code — they use only
 * `kysely` imports and literal snake_case identifiers (the app's CamelCasePlugin
 * is not installed on the migration connection).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('organizations_owner_id_unique')
    .ifExists()
    .execute();

  await db.schema
    .createIndex('organizations_owner_id_idx')
    .ifNotExists()
    .on('organizations')
    .column('owner_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Restoring the unique index requires at most one org per owner. Check first
  // so the rollback fails with the offending owners named, instead of aborting
  // mid-migration on an opaque Postgres unique-violation.
  const duplicates = await sql<{ owner_id: string; org_count: number }>`
    select owner_id, count(*)::int as org_count
    from organizations
    group by owner_id
    having count(*) > 1
    order by count(*) desc
  `.execute(db);

  if (duplicates.rows.length > 0) {
    const detail = duplicates.rows
      .map((r) => `${r.owner_id} (${r.org_count} orgs)`)
      .join(', ');
    throw new Error(
      `Cannot restore organizations_owner_id_unique: these owners have more than one organization — ${detail}. ` +
        'Reassign or delete the extra organizations before rolling back.',
    );
  }

  await db.schema.dropIndex('organizations_owner_id_idx').ifExists().execute();

  await db.schema
    .createIndex('organizations_owner_id_unique')
    .ifNotExists()
    .unique()
    .on('organizations')
    .column('owner_id')
    .execute();
}
