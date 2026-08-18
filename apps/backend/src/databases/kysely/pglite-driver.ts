import type { PGlite } from '@electric-sql/pglite';
import {
  CompiledQuery,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from 'kysely';

/**
 * Kysely dialect over PGlite (Postgres compiled to WASM).
 *
 * Hand-rolled rather than `kysely-pglite`: that package's `create-migrator`
 * imports `Migrator` from the `kysely` package root, which moved to the
 * `kysely/migration` subpath in 0.29 — importing it crashes at load time on any
 * kysely newer than our pin. See docs/receipts/PHASE-0.md, check S4. This file
 * only uses `Dialect`/`Driver`/`DatabaseConnection` and the Postgres
 * adapter/introspector/compiler, none of which moved.
 */
class PGliteConnection implements DatabaseConnection {
  constructor(private readonly pg: PGlite) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const res = await this.pg.query<R>(query.sql, [...query.parameters]);
    return { rows: res.rows, numAffectedRows: BigInt(res.affectedRows ?? 0) };
  }

  // eslint-disable-next-line require-yield, @typescript-eslint/require-await
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('PGlite driver does not support streaming');
  }
}

/**
 * PGlite is a single embedded instance, so there is exactly one connection.
 * Kysely hands out that one connection to every caller, which means two
 * overlapping `db.transaction()` calls would interleave their BEGIN/COMMIT on
 * the same session and corrupt each other's atomicity. The mutex serialises
 * connection handout for the whole lifetime of a checkout, which is what makes
 * transactions safe here.
 *
 * ponytail: one global lock over all checkouts. On a single-user desktop the
 * contention is two job-runner loops plus loopback HTTP, which is nothing. If
 * throughput ever matters the upgrade path is PGlite's own worker/multi-instance
 * support, not a hand-rolled pool.
 */
class PGliteDriver implements Driver {
  private connection!: PGliteConnection;
  private queue: Promise<unknown> = Promise.resolve();
  private releaseCurrent: (() => void) | null = null;

  constructor(private readonly pg: PGlite) {}

  async init(): Promise<void> {
    await this.pg.waitReady;
    this.connection = new PGliteConnection(this.pg);
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const previous = this.queue;
    this.queue = gate;
    await previous;
    this.releaseCurrent = release;
    return this.connection;
  }

  // Driver requires a Promise-returning signature; releasing the gate is sync.
  // eslint-disable-next-line @typescript-eslint/require-await
  async releaseConnection(): Promise<void> {
    this.releaseCurrent?.();
    this.releaseCurrent = null;
  }

  async beginTransaction(c: DatabaseConnection): Promise<void> {
    await c.executeQuery(CompiledQuery.raw('begin'));
  }

  async commitTransaction(c: DatabaseConnection): Promise<void> {
    await c.executeQuery(CompiledQuery.raw('commit'));
  }

  async rollbackTransaction(c: DatabaseConnection): Promise<void> {
    await c.executeQuery(CompiledQuery.raw('rollback'));
  }

  async destroy(): Promise<void> {
    await this.pg.close();
  }
}

export function pgliteDialect(pg: PGlite): Dialect {
  return {
    createDriver: () => new PGliteDriver(pg),
    createAdapter: () => new PostgresAdapter(),
    createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  };
}
