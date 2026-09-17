import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  CamelCasePlugin,
  Kysely,
  Migrator,
  type MigrationProvider,
} from 'kysely';
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
 * The pre-migration snapshot, a sibling of the data directory — so with the
 * Electron `DATA_DIR`, `userData/data` is backed up to `userData/data.bak`.
 */
export function resolveBackupDir(dataDir = resolveDataDir()): string {
  return `${dataDir}.bak`;
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
 *
 * `provider` is a parameter only so the R7 upgrade tests can stand up a real
 * vN database and migrate it to a vN+1 chain; the app always uses the default.
 */
export async function migrateToLatest(
  db: AppDatabase,
  logger?: Logger,
  provider: MigrationProvider = staticMigrationProvider,
) {
  const migrator = new Migrator({ db: db.withoutPlugins(), provider });

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

  const applied = results ?? [];
  logger?.log(
    applied.length === 0
      ? 'database up to date'
      : `applied ${applied.length} migration(s)`,
  );
  return applied;
}

/** Is any migration in `provider` not yet recorded in this database? */
async function hasPendingMigrations(
  db: AppDatabase,
  provider: MigrationProvider,
): Promise<boolean> {
  // `getMigrations()` checks for the migration table before reading it, so this
  // is also safe on a data directory that has never been migrated.
  const migrations = await new Migrator({
    db: db.withoutPlugins(),
    provider,
  }).getMigrations();
  return migrations.some((migration) => !migration.executedAt);
}

/**
 * Open the app's database, applying pending migrations behind a backup of the
 * user's data (plan risk R7 — "migration on app upgrade corrupts user data").
 *
 * On a boot that has migrations to apply to an *existing* database, the data
 * directory is copied to `data.bak` first; if any migration throws, the copy is
 * moved back over the live directory and the error is rethrown, so the app
 * refuses to start on a half-migrated database instead of running against one.
 *
 * PGlite is closed around the copy. A snapshot taken while Postgres holds the
 * directory open can miss buffers it has not written yet — i.e. the backup
 * itself would be the corruption this exists to prevent. The reopen costs one
 * extra PGlite start, on upgrade boots only.
 *
 * Two boots are deliberately *not* backed up: a first launch (nothing to lose)
 * and an up-to-date database (nothing runs). Otherwise every launch would copy
 * the whole data directory.
 *
 * The backup is kept after a successful upgrade — it is the only rollback a
 * desktop user has if the new version's schema turns out to mangle their data —
 * and overwritten by the next upgrade, so at most one snapshot ever exists.
 */
export async function openMigratedDatabase(
  dataDir = resolveDataDir(),
  logger?: Logger,
  provider: MigrationProvider = staticMigrationProvider,
): Promise<AppDatabase> {
  // Read before createPGlite(), which creates the directory itself.
  const isExisting = existsSync(path.join(dataDir, 'PG_VERSION'));
  let db = createAppDatabase(dataDir);

  if (!isExisting || !(await hasPendingMigrations(db, provider))) {
    await migrateToLatest(db, logger, provider);
    return db;
  }

  const backupDir = resolveBackupDir(dataDir);
  await db.destroy();
  rmSync(backupDir, { recursive: true, force: true, maxRetries: 5 });
  cpSync(dataDir, backupDir, { recursive: true });
  logger?.log(`backed up ${dataDir} to ${backupDir} before migrating`);

  db = createAppDatabase(dataDir);
  try {
    await migrateToLatest(db, logger, provider);
    return db;
  } catch (error) {
    // Close before touching the directory, and do not let a failing close hide
    // the migration error or skip the restore.
    await db.destroy().catch(() => undefined);
    // The backup is a complete copy at every instant of this: the dirty
    // directory is removed first, then the snapshot is renamed into its place
    // (same parent, so the move is atomic and cannot half-copy).
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
    renameSync(backupDir, dataDir);
    logger?.error(`migration failed; restored ${dataDir} from ${backupDir}`);
    throw error;
  }
}

const bootLogger = new Logger('KyselyModule');

@Global()
@Module({
  providers: [
    {
      provide: KYSELY_DB,
      // There is no operator on a user's laptop, so migrations run at boot —
      // here rather than in `onModuleInit` because the R7 backup has to close
      // and reopen PGlite, which is only possible before the handle every
      // repository holds has been handed out. Nest awaits an async factory
      // before it constructs anything that injects the token.
      useFactory: () => openMigratedDatabase(resolveDataDir(), bootLogger),
    },
  ],
  exports: [KYSELY_DB],
})
export class KyselyModule implements OnModuleDestroy {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
