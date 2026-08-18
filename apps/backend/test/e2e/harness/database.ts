import { randomBytes } from 'node:crypto';
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import { Client, Pool } from 'pg';
import { inject } from 'vitest';
// Type-only import: keeps this module free of src/databases/kysely's
// side effects (it sets a process-wide pg int8 type parser at module scope).
import type { Database } from '../../../src/databases/kysely/database.types';

const TEMPLATE_DB = 'e2e_template';

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export interface FileDatabase {
  /** Configured exactly like the application's instance, CamelCasePlugin included. */
  db: Kysely<Database>;
  databaseUrl: string;
  close: () => Promise<void>;
}

/**
 * Clone the migrated template into a database private to this test file, and
 * point DATABASE_URL at it. Postgres copies the template's files directly, so
 * this is milliseconds rather than a migration replay.
 *
 * Call this in a `beforeAll`, before the file's first `createTestApp()`.
 */
export async function createFileDatabase(): Promise<FileDatabase> {
  const adminUrl = inject('postgresAdminUrl');
  const databaseName = `e2e_${randomBytes(6).toString('hex')}`;

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(
      `CREATE DATABASE "${databaseName}" TEMPLATE "${TEMPLATE_DB}"`,
    );
  } finally {
    await admin.end();
  }

  const databaseUrl = withDatabase(adminUrl, databaseName);
  process.env.DATABASE_URL = databaseUrl;

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  });

  return {
    db,
    databaseUrl,
    close: async () => {
      await db.destroy();
    },
  };
}
