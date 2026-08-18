/**
 * Phase 2 acceptance harness.
 *
 * Full app boot is not possible yet (auth/temporal modules are mid-migration),
 * so this drives the Kysely provider + migration runner directly — the same
 * `createAppDatabase()` / `migrateToLatest()` the module's factory and
 * `onModuleInit` call — against a throwaway DATA_DIR.
 *
 *   pnpm --filter backend exec tsx src/databases/kysely/__tests__/boot-migrations.harness.ts
 *
 * Asserts: fresh dir -> 16 migrations applied + singleton user/org/membership
 * seeded; second boot -> 0 migrations applied, no duplicate seeds.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LOCAL_ORG_ID, LOCAL_USER_ID } from '../../../local/local-identity';
import * as seed from '../../../migrations/00016_seed_local_singleton';
import { createAppDatabase, migrateToLatest } from '../kysely.module';

const dataDir = mkdtempSync(path.join(tmpdir(), 'devsummary-p2-'));

type Counts = {
  users: number;
  orgs: number;
  members: number;
  owners: number;
};

async function boot(label: string): Promise<{
  applied: number;
  counts: Counts;
}> {
  const db = createAppDatabase(path.join(dataDir, 'data'));
  try {
    const applied = await migrateToLatest(db);
    console.log(`[${label}] migrations applied: ${applied.length}`);
    for (const r of applied) console.log(`  ${r.status} ${r.migrationName}`);

    const counts: Counts = {
      users: Number(
        (
          await db
            .selectFrom('auth.user')
            .select((eb) => eb.fn.countAll().as('c'))
            .where('id', '=', LOCAL_USER_ID)
            .executeTakeFirstOrThrow()
        ).c,
      ),
      orgs: Number(
        (
          await db
            .selectFrom('organizations')
            .select((eb) => eb.fn.countAll().as('c'))
            .where('id', '=', LOCAL_ORG_ID)
            .executeTakeFirstOrThrow()
        ).c,
      ),
      members: Number(
        (
          await db
            .selectFrom('organizationMembers')
            .select((eb) => eb.fn.countAll().as('c'))
            .where('organizationId', '=', LOCAL_ORG_ID)
            .where('userId', '=', LOCAL_USER_ID)
            .executeTakeFirstOrThrow()
        ).c,
      ),
      owners: Number(
        (
          await db
            .selectFrom('organizationMembers')
            .select((eb) => eb.fn.countAll().as('c'))
            .where('organizationId', '=', LOCAL_ORG_ID)
            .where('role', '=', 'owner')
            .executeTakeFirstOrThrow()
        ).c,
      ),
    };
    console.log(`[${label}] counts:`, counts);

    // The jobs table from 00015 exists and is queryable (CamelCasePlugin maps
    // maxAttempts -> max_attempts, so this also proves the plugin is installed).
    const jobs = await db
      .selectFrom('jobs')
      .select(['id', 'maxAttempts', 'runAt'])
      .execute();
    console.log(`[${label}] jobs rows: ${jobs.length}`);
    await db.selectFrom('localSettings').select('key').execute();

    return { applied: applied.length, counts };
  } finally {
    await db.destroy();
  }
}

async function main() {
  console.log(`DATA_DIR = ${dataDir}`);

  console.log('\n=== boot 1: fresh data directory ===');
  const first = await boot('boot1');
  assert.equal(first.applied, 16, 'fresh boot must apply all 16 migrations');
  assert.deepEqual(first.counts, { users: 1, orgs: 1, members: 1, owners: 1 });

  console.log('\n=== boot 2: same data directory ===');
  const second = await boot('boot2');
  assert.equal(second.applied, 0, 'second boot must apply zero migrations');
  assert.deepEqual(second.counts, { users: 1, orgs: 1, members: 1, owners: 1 });

  // The migrator's bookkeeping is what stops 00016 running twice in practice.
  // This runs its `up()` directly a second time to prove the seed itself is
  // idempotent — i.e. that the bare `on conflict do nothing` also absorbs the
  // partial `organization_members_single_owner_unique` index from 00005, which a
  // column-targeted conflict clause would not.
  console.log('\n=== 00016 up() re-run directly (idempotency) ===');
  const db = createAppDatabase(path.join(dataDir, 'data'));
  try {
    await seed.up(db.withoutPlugins() as never);
    const rows = await db
      .selectFrom('organizationMembers')
      .select(['organizationId', 'userId', 'role'])
      .execute();
    console.log('organization_members rows:', rows);
    assert.equal(rows.length, 1, 're-running the seed must not duplicate rows');
    assert.equal(rows[0].role, 'owner');
  } finally {
    await db.destroy();
  }

  console.log('\nPHASE-2 HARNESS PASSED');
}

main()
  .then(() => rmSync(dataDir, { recursive: true, force: true }))
  .catch((err) => {
    console.error(err);
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(1);
  });
