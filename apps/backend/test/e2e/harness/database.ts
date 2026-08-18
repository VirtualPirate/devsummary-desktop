import { PGlite } from '@electric-sql/pglite';
import { CamelCasePlugin, Kysely, Migrator } from 'kysely';
import type { Database } from '../../../src/databases/kysely/database.types';
import { staticMigrationProvider } from '../../../src/databases/kysely/migrations-index';
import { pgliteDialect } from '../../../src/databases/kysely/pglite-driver';

export interface TestDatabase {
  /** Configured exactly like the application's instance, CamelCasePlugin included. */
  db: Kysely<Database>;
  /**
   * Only for specs that never call `createTestApp()`. When an app is booted on
   * this instance, `KyselyModule.onModuleDestroy` destroys it — so those specs
   * call `testApp.close()` and nothing else, or PGlite is closed twice.
   */
  close: () => Promise<void>;
}

/**
 * A private, in-memory Postgres for one test file.
 *
 * `new PGlite()` with no data directory keeps the whole database in WASM
 * memory: nothing to clean up, no Docker, and — unlike the `postgres:18`
 * testcontainer this replaces — no shared server, so files cannot see each
 * other's rows and there is no template database to clone from. The migration
 * chain is replayed per file instead (~1.2 s for all 16), which is cheaper than
 * the container start it removes.
 *
 * Call this in a `beforeAll`, before the file's `createTestApp()`.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const db = new Kysely<Database>({
    dialect: pgliteDialect(
      new PGlite({
        // Mirrors createPGlite() in src/databases/kysely/kysely.module.ts:
        // GitHub ids are int8 (oid 20) and must not arrive as lossy JS numbers.
        // Constructed here rather than through createAppDatabase() because that
        // helper always resolves a data directory, and this one has none.
        parsers: { 20: (value: string) => BigInt(value) },
      }),
    ),
    plugins: [new CamelCasePlugin()],
  });

  // The same chain KyselyModule applies at boot. Running it here means the
  // DB-only specs (which boot no app) get a migrated schema, and the app's own
  // boot migration then finds nothing pending.
  //
  // `withoutPlugins()` is load-bearing: migrations use literal snake_case
  // identifiers, so a CamelCasePlugin connection would re-translate them.
  const migrator = new Migrator({
    db: db.withoutPlugins(),
    provider: staticMigrationProvider,
  });
  const { error } = await migrator.migrateToLatest();
  if (error) {
    throw error instanceof Error
      ? error
      : new Error('e2e migrations failed', { cause: error });
  }

  return { db, close: () => db.destroy() };
}
