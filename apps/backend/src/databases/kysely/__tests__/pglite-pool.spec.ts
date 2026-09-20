import { PGlite } from '@electric-sql/pglite';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { Checkpoint } from '@langchain/langgraph-checkpoint';
import { CamelCasePlugin, Kysely } from 'kysely';
import type pg from 'pg';
import type { AppDatabase } from '../kysely.module';
import { pgliteDialect } from '../pglite-driver';
import { createPglitePool } from '../pglite-pool';

jest.setTimeout(60_000);

/**
 * The real `PostgresSaver` against a real (in-memory) Postgres, through the
 * shim. Mocking the pool here would only prove the shim matches what this file
 * guessed the saver does; the round-trip is the point — `bytea` comes back as a
 * `Uint8Array` instead of a `Buffer`, `array_agg(array[…::bytea])` has to
 * survive nesting, and `setup()`'s "table does not exist" probe depends on
 * PGlite reporting SQLSTATE `42P01` on the error it throws.
 *
 * `CamelCasePlugin` is installed exactly as the app installs it, so a shim that
 * forgot `withoutPlugins()` fails here rather than in production.
 *
 * Requires `NODE_OPTIONS=--experimental-vm-modules` (PGlite loads its WASM via a
 * dynamic import). The `test` script sets it.
 */
function createDb(): AppDatabase {
  return new Kysely({
    dialect: pgliteDialect(new PGlite()),
    plugins: [new CamelCasePlugin()],
  }) as unknown as AppDatabase;
}

function checkpoint(id: string): Checkpoint {
  return {
    v: 4,
    id,
    ts: new Date().toISOString(),
    channel_values: { messages: ['hello'] },
    channel_versions: { messages: 1 },
    versions_seen: { agent: { messages: 1 } },
  };
}

describe('createPglitePool + PostgresSaver', () => {
  let db: AppDatabase;
  let saver: PostgresSaver;

  beforeAll(async () => {
    db = createDb();
    saver = new PostgresSaver(
      createPglitePool(db) as unknown as pg.Pool,
      undefined,
      { schema: 'agents' },
    );
    await saver.setup();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates its tables in the schema it was given, and is idempotent', async () => {
    // Second call takes the "migrations table exists" branch, i.e. the one that
    // reads a row back rather than the one that swallows 42P01.
    await saver.setup();
    const { rows } = await createPglitePool(db).query(
      `select table_name from information_schema.tables where table_schema = 'agents' order by table_name`,
    );
    expect(rows.map((r: { table_name: string }) => r.table_name)).toEqual(
      expect.arrayContaining([
        'checkpoint_blobs',
        'checkpoint_migrations',
        'checkpoint_writes',
        'checkpoints',
      ]),
    );
  });

  it('round-trips a checkpoint through put and getTuple', async () => {
    const config = { configurable: { thread_id: 't1', checkpoint_ns: '' } };
    const next = await saver.put(
      config,
      checkpoint('c1'),
      { source: 'input', step: 1 } as never,
      {
        messages: 1,
      },
    );
    expect(next.configurable?.checkpoint_id).toBe('c1');

    const tuple = await saver.getTuple(next);
    expect(tuple?.checkpoint.id).toBe('c1');
    // The blob column is `bytea`, which PGlite hands back as a Uint8Array where
    // `pg` hands back a Buffer. If that did not decode, this is where it shows.
    expect(tuple?.checkpoint.channel_values).toEqual({ messages: ['hello'] });
  });

  it('lists a thread newest first', async () => {
    const config = { configurable: { thread_id: 't1', checkpoint_ns: '' } };
    await saver.put(
      config,
      checkpoint('c2'),
      { source: 'loop', step: 2 } as never,
      {
        messages: 2,
      },
    );

    const ids: string[] = [];
    for await (const tuple of saver.list(config)) ids.push(tuple.checkpoint.id);
    expect(ids).toEqual(['c2', 'c1']);
  });

  it('stores pending writes on the held connection', async () => {
    const config = {
      configurable: { thread_id: 't1', checkpoint_ns: '', checkpoint_id: 'c2' },
    };
    await saver.putWrites(config, [['messages', 'written']], 'task-1');
    const tuple = await saver.getTuple(config);
    expect(tuple?.pendingWrites).toEqual([['task-1', 'messages', 'written']]);
  });

  it('deletes a thread and leaves the others alone', async () => {
    const other = { configurable: { thread_id: 't2', checkpoint_ns: '' } };
    await saver.put(
      other,
      checkpoint('c3'),
      { source: 'input', step: 1 } as never,
      {
        messages: 1,
      },
    );

    await saver.deleteThread('t1');

    expect(
      await saver.getTuple({ configurable: { thread_id: 't1' } }),
    ).toBeUndefined();
    expect(
      (await saver.getTuple({ configurable: { thread_id: 't2' } }))?.checkpoint
        .id,
    ).toBe('c3');
  });

  it('releases the connection it borrowed, so the app can still query', async () => {
    // Every test above went through `connect()`. A leaked lease would deadlock
    // this statement behind PGliteDriver's mutex, so the assertion is simply
    // that it returns at all.
    const { rows } = await createPglitePool(db).query('select 1 as ok');
    expect(rows).toEqual([{ ok: 1 }]);
  });
});
