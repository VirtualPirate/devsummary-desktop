import { CompiledQuery } from 'kysely';
import type { AppDatabase } from './kysely.module';

/**
 * The slice of `pg.Pool` that `PostgresSaver` actually uses, backed by the app's
 * own Kysely/PGlite instance.
 *
 * `PostgresSaver` has two constructors: one takes a connection string, the other
 * a `pg.Pool`. There is no connection string here — PGlite is Postgres compiled
 * to WASM, running in-process with no wire protocol — so the pool is the seam.
 * Everything the saver touches is `pool.query`, `pool.connect()` → a client with
 * `query` and `release`, and `pool.end()`; that is the whole surface below, and
 * the call site casts it to `pg.Pool`.
 *
 * Two things are load-bearing:
 *
 * 1. **`withoutPlugins()`**. The app's Kysely runs `CamelCasePlugin`, which
 *    rewrites identifiers in both directions. The saver writes its own SQL with
 *    its own snake_case column names and reads `row.channel_values` back off the
 *    result; through the plugin those come back as `channelValues` and every
 *    read is silently undefined.
 * 2. **`connect()` holds one real Kysely connection** rather than handing back
 *    another view of the pool. PGlite has exactly one session, and
 *    `PGliteDriver`'s mutex is what stops two `BEGIN … COMMIT` blocks from
 *    interleaving on it. The saver opens a transaction in `put`, `putWrites` and
 *    `deleteThread`; borrowing the connection through Kysely puts those behind
 *    the same mutex as every application transaction, which is the only thing
 *    making them atomic here.
 *
 * `pg` hands back `Buffer` for a `bytea` column and PGlite hands back
 * `Uint8Array`. Nothing is converted: the saver's own decode path is
 * `new Uint8Array(value)` / `TextDecoder().decode(value)`, both of which take
 * either — see `pglite-pool.spec.ts`, which runs a real round-trip.
 */
export interface PgliteQueryResult {
  rows: any[];
  rowCount: number;
}

export interface PglitePoolClient {
  query: (
    textOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ) => Promise<PgliteQueryResult>;
  release: () => void;
}

export interface PglitePool {
  query: (
    textOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ) => Promise<PgliteQueryResult>;
  connect: () => Promise<PglitePoolClient>;
  end: () => Promise<void>;
}

function raw(
  textOrConfig: string | { text: string; values?: unknown[] },
  values?: unknown[],
): CompiledQuery {
  return typeof textOrConfig === 'string'
    ? CompiledQuery.raw(textOrConfig, values ?? [])
    : CompiledQuery.raw(textOrConfig.text, textOrConfig.values ?? values ?? []);
}

/**
 * `pg` reports the row count for a SELECT and the affected count for a write;
 * Kysely splits those into two fields and PGlite reports 0 affected rows for a
 * SELECT. Nothing in `PostgresSaver` reads it, but returning a plausible number
 * costs one line and keeps the shim honest against the interface it claims.
 */
function toResult(result: {
  rows: unknown[];
  numAffectedRows?: bigint;
}): PgliteQueryResult {
  return {
    rows: result.rows as any[],
    rowCount: result.rows.length || Number(result.numAffectedRows ?? 0),
  };
}

export function createPglitePool(db: AppDatabase): PglitePool {
  const plain = db.withoutPlugins();

  return {
    async query(textOrConfig, values) {
      return toResult(await plain.executeQuery(raw(textOrConfig, values)));
    },

    /**
     * Resolves with a client bound to one checked-out Kysely connection, held
     * until `release()`. The connection is checked out by
     * `connection().execute()`, whose callback stays pending for exactly as long
     * as the client is alive — that pending promise *is* the lease.
     */
    connect() {
      return new Promise<PglitePoolClient>((resolve, reject) => {
        void plain
          .connection()
          .execute(
            (conn) =>
              new Promise<void>((done) => {
                resolve({
                  query: async (textOrConfig, values) =>
                    toResult(
                      await conn.executeQuery(raw(textOrConfig, values)),
                    ),
                  release: done,
                });
              }),
          )
          // A failure to acquire happens before `resolve` above ever runs, so
          // without this the caller waits forever on a connection it will not get.
          .catch(reject);
      });
    },

    /** The app owns the PGlite lifetime; `KyselyModule.onModuleDestroy` closes it. */
    end: () => Promise.resolve(),
  };
}
