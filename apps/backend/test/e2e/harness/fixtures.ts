import type { Kysely } from 'kysely';
import type { Database } from '../../../src/databases/kysely/database.types';

/**
 * Insert a membership directly.
 *
 * Deliberately bypasses the invite flow: routing role setup through invites
 * would couple guard tests to invite behaviour, so a failure in either would
 * light up both suites.
 *
 * `role: 'owner'` only works on an org that has none. migrations/
 * 00005_organization_single_owner adds a partial unique index allowing one
 * owner row per organization, so seeding a second owner raises 23505.
 */
export async function seedMember(
  db: Kysely<Database>,
  member: {
    organizationId: string;
    userId: string;
    role: 'owner' | 'admin' | 'viewer';
  },
): Promise<void> {
  await db.insertInto('organizationMembers').values(member).execute();
}
