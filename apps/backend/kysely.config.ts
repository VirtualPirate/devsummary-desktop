import 'dotenv/config';
import { defineConfig } from 'kysely-ctl';
import { pgliteDialect } from './src/databases/kysely/pglite-driver';
import { staticMigrationProvider } from './src/databases/kysely/migrations-index';
import { createPGlite } from './src/databases/kysely/kysely.module';

/**
 * Authoring config for `db:generate` / `db:up` / `db:status`.
 *
 * Points at the same dev PGlite directory the headless backend uses
 * (`DATA_DIR/data`, else `./.data`) via the same hand-rolled dialect, so the CLI
 * and the app cannot disagree about the database. No plugins — migrations use
 * literal snake_case identifiers.
 *
 * `provider` (not `migrationFolder`) so the CLI walks the same static list the
 * app boots from: a migration missing from `src/databases/kysely/migrations-index.ts`
 * would otherwise apply here and silently never apply on a packaged install.
 * `migrate:make` writes into `migrations/` (kysely-ctl's default, and it takes
 * either a folder or a provider, not both) — **move the new file into
 * `src/migrations/` and add it to the index**, or it will never be compiled into
 * `dist/` and never apply on a packaged install.
 */
export default defineConfig({
  // `as never`: kysely-ctl is ESM and sees kysely's ESM `Dialect`; this file
  // compiles as CJS and sees the CJS one. Structurally identical, nominally
  // distinct (private `#private` field), and that is the whole of the
  // incompatibility — verified by `db:up` applying all 16 migrations.
  dialect: (() => pgliteDialect(createPGlite())) as never,
  migrations: {
    provider: staticMigrationProvider,
  },
});
