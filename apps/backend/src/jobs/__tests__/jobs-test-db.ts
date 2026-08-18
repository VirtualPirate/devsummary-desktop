import { PGlite } from '@electric-sql/pglite';
import { CamelCasePlugin, Kysely } from 'kysely';
import { up as createJobsTable } from '../../migrations/00015_jobs';
import { pgliteDialect } from '../../databases/kysely/pglite-driver';
import type { AppDatabase } from '../../databases/kysely';

/**
 * An in-memory PGlite holding just the `jobs` table (migration 00015), wired
 * through the real driver and `CamelCasePlugin`.
 *
 * Real Postgres rather than a mocked query builder because the things worth
 * asserting about this table *are* the SQL: `on conflict do nothing` dedup, the
 * single-statement claim, and `run_at <= now()`.
 *
 * Requires `NODE_OPTIONS=--experimental-vm-modules` (PGlite loads its WASM via a
 * dynamic import, which Jest's VM refuses without it). The `test` script sets it.
 */
export async function createJobsDb(): Promise<AppDatabase> {
  const db = new Kysely({
    dialect: pgliteDialect(new PGlite()),
    plugins: [new CamelCasePlugin()],
  }) as unknown as AppDatabase;
  await createJobsTable(db);
  return db;
}
