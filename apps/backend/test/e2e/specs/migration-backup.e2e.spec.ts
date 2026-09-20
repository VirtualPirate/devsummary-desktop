import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  sql,
  type Kysely,
  type Migration,
  type MigrationProvider,
} from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDatabase } from '../../../src/databases/kysely/kysely.module';
import {
  createAppDatabase,
  openMigratedDatabase,
  resolveBackupDir,
} from '../../../src/databases/kysely/kysely.module';
import {
  MIGRATIONS,
  staticMigrationProvider,
} from '../../../src/databases/kysely/migrations-index';

/**
 * Risk R7 — "migration on app upgrade corrupts user data" (plan §8, Phase 10).
 *
 * The one flow with a real data directory rather than the in-memory PGlite the
 * rest of the e2e suite uses: `data.bak` only means anything on disk. Each `it`
 * is one launch of a successive app version against the *same* directory, so
 * they run in order and share state — that sequence is the thing under test.
 *
 *   vN     every shipped migration, then the user generates data
 *   vN+1   one new migration, applied behind a backup
 *   vN+2   a migration that throws after committing, so the migrator's own
 *          rollback cannot undo it and only the backup can
 */
const provider = (
  migrations: Record<string, Migration>,
): MigrationProvider => ({
  getMigrations: () => Promise.resolve(migrations),
});

const NEXT_MIGRATIONS: Record<string, Migration> = {
  ...MIGRATIONS,
  '00020_r7_probe': {
    up: async (db: Kysely<unknown>) => {
      await db.schema
        .createTable('r7_probe')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .execute();
    },
  },
};

const V_NEXT = provider(NEXT_MIGRATIONS);

// Every already-applied migration has to stay in the list — the migrator treats
// a missing one as a corrupted history and refuses to run at all.
const V_BROKEN = provider({
  ...NEXT_MIGRATIONS,
  '00021_r7_boom': {
    up: async (db: Kysely<unknown>) => {
      // Kysely runs the whole batch in one transaction on Postgres, so a plain
      // `throw` would be undone by the rollback and prove nothing about the
      // backup. Ending the transaction first is what a migration doing
      // non-transactional work looks like from the runner's side: the table
      // below is committed, the rollback has nothing left to undo, and
      // restoring the backup is the only thing that can remove it.
      await sql`commit`.execute(db);
      await db.schema
        .createTable('r7_wreckage')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .execute();
      throw new Error('r7 boom');
    },
  },
});

let dataDir: string;
let backupDir: string;

/** Is `table` present in this data directory right now? */
async function tables(dir: string): Promise<string[]> {
  const db = createAppDatabase(dir);
  try {
    const { rows } = await sql<{ tablename: string }>`
      select tablename from pg_tables where schemaname = 'public'
    `.execute(db);
    return rows.map((r) => r.tablename);
  } finally {
    await db.destroy();
  }
}

async function marker(db: AppDatabase): Promise<unknown> {
  const row = await db
    .selectFrom('localSettings')
    .select('value')
    .where('key', '=', 'r7_marker')
    .executeTakeFirst();
  return row?.value;
}

beforeAll(() => {
  dataDir = path.join(
    mkdtempSync(path.join(tmpdir(), 'devsummary-r7-')),
    'data',
  );
  backupDir = resolveBackupDir(dataDir);
});

afterAll(() => {
  rmSync(path.dirname(dataDir), { recursive: true, force: true });
});

describe('R7 — migration backup on upgrade', () => {
  it('vN: a first launch migrates without copying anything', async () => {
    const db = await openMigratedDatabase(
      dataDir,
      undefined,
      staticMigrationProvider,
    );
    try {
      // A fresh install has no user data to protect, and copying a data
      // directory on every first launch would be pure cost.
      expect(existsSync(backupDir)).toBe(false);

      await db
        .insertInto('localSettings')
        .values({ key: 'r7_marker', value: JSON.stringify({ survives: true }) })
        .execute();
      expect(await marker(db)).toEqual({ survives: true });
    } finally {
      await db.destroy();
    }
  });

  it('vN+1: backs up before migrating, and the user data survives', async () => {
    const db = await openMigratedDatabase(dataDir, undefined, V_NEXT);
    try {
      expect(await marker(db)).toEqual({ survives: true });
      expect(await tables(backupDir)).not.toContain('r7_probe');
    } finally {
      await db.destroy();
    }

    // The backup is the *pre*-migration database: same rows, old schema.
    expect(existsSync(backupDir)).toBe(true);
    expect(await tables(dataDir)).toContain('r7_probe');
  });

  it('an up-to-date launch does not touch the backup', async () => {
    rmSync(backupDir, { recursive: true, force: true });
    const db = await openMigratedDatabase(dataDir, undefined, V_NEXT);
    try {
      expect(await marker(db)).toEqual({ survives: true });
    } finally {
      await db.destroy();
    }
    expect(existsSync(backupDir)).toBe(false);
  });

  it('vN+2: a failing migration is restored from the backup and refuses to start', async () => {
    await expect(
      openMigratedDatabase(dataDir, undefined, V_BROKEN),
    ).rejects.toThrow('r7 boom');

    const live = await tables(dataDir);
    expect(live).toContain('r7_probe'); // vN+1 still applied
    expect(live).not.toContain('r7_wreckage'); // vN+2's committed damage, gone

    // Restored by moving the snapshot back, so the backup is consumed.
    expect(existsSync(backupDir)).toBe(false);
  });

  it('the restored directory is a working vN+1 database', async () => {
    const db = await openMigratedDatabase(dataDir, undefined, V_NEXT);
    try {
      expect(await marker(db)).toEqual({ survives: true });
      // No backup: the failed migration was never recorded as applied and the
      // ones before it still are, so this launch has nothing pending to run.
      expect(existsSync(backupDir)).toBe(false);
    } finally {
      await db.destroy();
    }
  });
});
