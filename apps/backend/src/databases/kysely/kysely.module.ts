import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CamelCasePlugin, Kysely, Migrator } from 'kysely';
import type { Database } from './database.types';
import { KYSELY_DB } from './kysely.token';
import { staticMigrationProvider } from './migrations-index';
import { pgliteDialect } from './pglite-driver';

export type AppDatabase = Kysely<Database>;

/**
 * Where PGlite keeps its data directory.
 *
 * `DATA_DIR` is set by the Electron main process to `app.getPath('userData')`;
 * the `data` subdirectory keeps the database out of the way of `secrets.bin` and
 * anything else that lands in userData. `./.data` is the headless-dev fallback.
 */
export function resolveDataDir(): string {
  const base = process.env.DATA_DIR;
  return base ? path.join(base, 'data') : './.data';
}

/**
 * The one place PGlite is constructed, so the int8 parser is never missed.
 * PGlite's `mkdirSync` is not recursive, so it throws ENOENT on a data dir whose
 * parent does not exist yet (first headless run, fresh `userData`).
 */
export function createPGlite(dataDir = resolveDataDir()): PGlite {
  mkdirSync(dataDir, { recursive: true });
  return new PGlite(dataDir, {
    // Mirrors SOURCE's `types.setTypeParser(types.builtins.INT8, BigInt)`:
    // GitHub ids are bigint and must not arrive as lossy JS numbers. This
    // already matches PGlite's default, pinned so it cannot drift upstream.
    // Aggregates like count() therefore also return BigInt — Number() at call
    // sites. (oid 20 = int8)
    parsers: { 20: (value: string) => BigInt(value) },
  });
}

/**
 * PGlite + Kysely, wired the way the app expects it. Exported so the migration
 * CLI (`kysely.config.ts`) and tests build the exact same stack the app boots.
 */
export function createAppDatabase(dataDir = resolveDataDir()): AppDatabase {
  return new Kysely<Database>({
    dialect: pgliteDialect(createPGlite(dataDir)),
    plugins: [new CamelCasePlugin()],
  });
}

/**
 * Apply every pending migration.
 *
 * `withoutPlugins()` is load-bearing: migrations use literal snake_case
 * identifiers (see the header on every file in `migrations/`) because kysely-ctl
 * ran them on a plugin-free connection. Handing them a CamelCasePlugin
 * connection would put the identifier translation back in the path this code has
 * never been tested under.
 */
export async function migrateToLatest(db: AppDatabase, logger?: Logger) {
  const migrator = new Migrator({
    db: db.withoutPlugins(),
    provider: staticMigrationProvider,
  });

  const { error, results } = await migrator.migrateToLatest();

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      logger?.log(`applied migration ${result.migrationName}`);
    } else if (result.status === 'Error') {
      logger?.error(`failed migration ${result.migrationName}`);
    }
  }

  // Migrator types `error` as unknown; a bare rethrow can surface a non-Error
  // and lose the stack the boot dialog needs.
  if (error) {
    throw error instanceof Error
      ? error
      : new Error('migration failed', { cause: error });
  }
  return results ?? [];
}

@Global()
@Module({
  providers: [{ provide: KYSELY_DB, useFactory: () => createAppDatabase() }],
  exports: [KYSELY_DB],
})
export class KyselyModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KyselyModule.name);

  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  /**
   * There is no operator on a user's laptop, so migrations run at boot. Nest
   * resolves this global module before the feature modules that depend on it,
   * so this completes before any repository issues its first query.
   */
  async onModuleInit() {
    const applied = await migrateToLatest(this.db, this.logger);
    this.logger.log(
      applied.length === 0
        ? 'database up to date'
        : `applied ${applied.length} migration(s)`,
    );
  }

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
