import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { SA_ORG, SA_PHASE } from '../../src/temporal/search-attributes';

const execFileAsync = promisify(execFile);

const TEMPLATE_DB = 'e2e_template';
const BACKEND_DIR = fileURLToPath(new URL('../..', import.meta.url));

let container: StartedPostgreSqlContainer | undefined;
let temporal: TestWorkflowEnvironment | undefined;

// `SearchAttributeKey` is the plain `{ name, type }` interface from
// @temporalio/common, and `defineSearchAttributeKey()` only builds that object.
// @temporalio/common is not a resolvable dependency of this package (only a
// transitive one of @temporalio/client and /testing), so the keys are written
// as literals — the same workaround, for the same reason, that
// src/temporal/schedules.bootstrap.ts uses for the proto enum.
const KEYWORD = 'KEYWORD' as const;

/** Swap the database name in a Postgres connection URL. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * `CREATE DATABASE ... TEMPLATE x` fails while any session is connected to x.
 * kysely.config.ts builds its pool with max: 1 and the CLI runs in a child
 * process, so its connection closes on exit — but not always instantly. Poll
 * until the count reaches zero and give a legible error if it never does;
 * Postgres's own message ("source database is being accessed by other users")
 * is opaque enough to be worth pre-empting.
 */
async function waitForNoConnections(
  admin: Client,
  database: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await admin.query<{ n: string }>(
      'select count(*)::int as n from pg_stat_activity where datname = $1',
      [database],
    );
    if (Number(result.rows[0].n) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Connections to "${database}" did not drain after 5s. ` +
      'CREATE DATABASE ... TEMPLATE will fail.',
  );
}

export async function setup(project: TestProject): Promise<void> {
  try {
    container = await new PostgreSqlContainer('postgres:18')
      // Each booted app opens TWO pg pools (the application Kysely pool and
      // Better Auth's own pool from createAuth()), each defaulting to max 10.
      // Four parallel files booting two apps each is 160 worst case. The
      // container is disposable, so buy headroom rather than tune to the edge.
      .withCommand(['postgres', '-c', 'max_connections=300'])
      .start();
  } catch (error) {
    throw new Error(
      'Could not start the Postgres test container. Is Docker running? ' +
        'e2e tests need Docker Desktop.\n' +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const adminUrl = container.getConnectionUri();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  try {
    await admin.query(`CREATE DATABASE "${TEMPLATE_DB}"`);

    // Run the real migration chain (00001_init onward), via the same CLI
    // `pnpm db:up` uses, so a broken migration fails the suite instead of
    // surfacing as dozens of confusing "relation does not exist" errors.
    try {
      await execFileAsync('pnpm', ['exec', 'kysely', 'migrate:latest'], {
        cwd: BACKEND_DIR,
        env: {
          ...process.env,
          DATABASE_URL: withDatabase(adminUrl, TEMPLATE_DB),
        },
      });
    } catch (error) {
      const err = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      throw new Error(
        'Migrations failed against the test database.\n' +
          `stdout:\n${err.stdout ?? ''}\nstderr:\n${err.stderr ?? err.message ?? ''}`,
      );
    }

    await waitForNoConnections(admin, TEMPLATE_DB);
  } finally {
    await admin.end();
  }

  project.provide('postgresAdminUrl', adminUrl);

  // createLocal runs the real Temporal CLI dev server on SQLite. The
  // alternative, createTimeSkipping, runs the Java test server, which has no
  // Schedules support and would break SchedulesBootstrap. Time skipping is not
  // needed for API-level tests.
  //
  // First run downloads the server binary to a cache directory and needs
  // network access once.
  temporal = await TestWorkflowEnvironment.createLocal({
    server: {
      searchAttributes: [
        { name: SA_ORG, type: KEYWORD },
        { name: SA_PHASE, type: KEYWORD },
      ],
    },
  });

  project.provide('temporalAddress', temporal.address);

  // Testcontainers' Ryuk sidecar reaps the Postgres container if the run is
  // killed. The Temporal dev server is an unmanaged child process, so Ctrl-C
  // would otherwise leak it holding a port.
  const onSignal = () => {
    void teardown().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}

export async function teardown(): Promise<void> {
  await temporal?.teardown();
  temporal = undefined;
  await container?.stop();
  container = undefined;
}

declare module 'vitest' {
  interface ProvidedContext {
    postgresAdminUrl: string;
    temporalAddress: string;
  }
}
