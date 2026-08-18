import { Kysely } from 'kysely';
import {
  LOCAL_ORG_ID,
  LOCAL_ORG_NAME,
  LOCAL_USER_EMAIL,
  LOCAL_USER_ID,
  LOCAL_USER_NAME,
} from '../local/local-identity';

/**
 * Seed the single local identity: one `auth.user`, one `organizations` row, and
 * the `organization_members` row that makes that user its `owner`.
 *
 * The membership row is not optional. Better Auth is gone but role checks are
 * not (docs/DELTAS.md D-A keeps workspaces): `@RequireOrgRole('owner'|'admin')`
 * still reads `organization_members`, so without this row every write endpoint
 * 403s on a fresh install.
 *
 * Idempotent: every insert is a bare `on conflict do nothing`, with no conflict
 * target, so it absorbs *all* unique violations — including the partial
 * `organization_members_single_owner_unique` index added in 00005 and
 * `organizations_slug_unique` from 00001, which a column-targeted
 * `on conflict (organization_id, user_id)` would not.
 *
 * Deviation from the "migrations import only kysely" convention in 00001–00014:
 * the ids are imported from `src/local/local-identity.ts` rather than repeated
 * here, because the guards and the session shim must agree with them exactly and
 * two copies of a UUID is how they stop agreeing.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db
    .withSchema('auth')
    .insertInto('user')
    .values({
      id: LOCAL_USER_ID,
      name: LOCAL_USER_NAME,
      email: LOCAL_USER_EMAIL,
      email_verified: true,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();

  await db
    .insertInto('organizations')
    .values({
      id: LOCAL_ORG_ID,
      name: LOCAL_ORG_NAME,
      slug: 'my-workspace',
      owner_id: LOCAL_USER_ID,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();

  await db
    .insertInto('organization_members')
    .values({
      organization_id: LOCAL_ORG_ID,
      user_id: LOCAL_USER_ID,
      role: 'owner',
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // organizations.owner_id is ON DELETE RESTRICT, so the user goes last.
  await db
    .deleteFrom('organization_members')
    .where('organization_id', '=', LOCAL_ORG_ID)
    .where('user_id', '=', LOCAL_USER_ID)
    .execute();

  await db.deleteFrom('organizations').where('id', '=', LOCAL_ORG_ID).execute();

  await db
    .withSchema('auth')
    .deleteFrom('user')
    .where('id', '=', LOCAL_USER_ID)
    .execute();
}
