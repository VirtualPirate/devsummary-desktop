import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { LOCAL_ORG_ID, LOCAL_USER_ID } from '../../../src/local/local-identity';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';

describe('outbound network isolation', () => {
  it('stubs every outbound network module at the unit-test seam', async () => {
    // `__reset` exists only on src/__mocks__/*, so this fails the moment an
    // alias in vitest.e2e.config.ts stops matching and a real client — able to
    // reach github.com, api.openai.com or slack.com — is loaded into the app
    // instead.
    const [octokit, slack, openai] = await Promise.all([
      import('@octokit/core'),
      import('@slack/web-api'),
      import('openai'),
    ]);
    expect(typeof (octokit.Octokit as { __reset?: unknown }).__reset).toBe(
      'function',
    );
    expect(typeof (slack.WebClient as { __reset?: unknown }).__reset).toBe(
      'function',
    );
    expect(typeof (openai as { __reset?: unknown }).__reset).toBe('function');

    // The agent CLIs' spawn. `__setExecFile` exists only on the fake, so this
    // fails the moment the alias stops matching and the real `execFile` — able
    // to run any binary on the machine — is loaded into the app instead.
    const childProcess = (await import('node:child_process')) as {
      __setExecFile?: unknown;
    };
    expect(typeof childProcess.__setExecFile).toBe('function');
  });
});

describe('in-memory PGlite', () => {
  let db: Kysely<Database>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });

  afterAll(async () => {
    await close();
  });

  it('has every schema the migrations create', async () => {
    const rows = await sql<{ schemaName: string }>`
      select schema_name from information_schema.schemata
    `.execute(db);
    const names = rows.rows.map((r) => r.schemaName);
    expect(names).toEqual(
      expect.arrayContaining(['auth', 'github', 'slack', 'briefs']),
    );
  });

  it('starts with the seeded singleton and nothing else', async () => {
    // Cast to ::int deliberately. count(*) is int8, and the PGlite instance is
    // built with an int8 parser mapping to BigInt, so an un-cast count arrives
    // as 1n and fails toBe(1). int4 is always a JS number.
    const users = await sql<{ n: number }>`
      select count(*)::int as n from auth."user"
    `.execute(db);
    const orgs = await sql<{ n: number }>`
      select count(*)::int as n from public.organizations
    `.execute(db);
    const commits = await sql<{ n: number }>`
      select count(*)::int as n from github.commits
    `.execute(db);
    expect(users.rows[0].n).toBe(1);
    expect(orgs.rows[0].n).toBe(1);
    expect(commits.rows[0].n).toBe(0);
  });

  it('seeds the local user as owner of the default workspace', async () => {
    const membership = await db
      .selectFrom('organizationMembers')
      .select('role')
      .where('organizationId', '=', LOCAL_ORG_ID)
      .where('userId', '=', LOCAL_USER_ID)
      .executeTakeFirst();
    expect(membership?.role).toBe('owner');
  });

  it('exposes the camelCase Kysely surface the app uses', async () => {
    // Proves CamelCasePlugin is wired: 'auth.user' + 'emailVerified' only
    // resolve if the plugin rewrites them to auth.user / email_verified.
    const row = await db
      .selectFrom('auth.user')
      .select(['id', 'emailVerified'])
      .executeTakeFirst();
    expect(row?.id).toBe(LOCAL_USER_ID);
  });
});

describe('app harness', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    const { db } = await createTestDatabase();
    testApp = await createTestApp(db);
  });

  afterAll(async () => {
    // Closes the PGlite instance too — KyselyModule owns the injected handle.
    await testApp.close();
  });

  it('serves the anonymous liveness route without a token', async () => {
    const res = await request(testApp.server).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('reports the database as healthy on the readiness route', async () => {
    const res = await request(testApp.server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.checks.database.status).toBe('ok');
  });

  it('refuses everything else without x-desktop-token', async () => {
    // LocalTokenGuard is the only thing between this API and every other
    // process on the machine; loopback is not a trust boundary.
    const res = await request(testApp.server).get('/api/organizations/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a wrong token', async () => {
    const res = await request(testApp.server)
      .get('/api/organizations/me')
      .set('x-desktop-token', 'nope');
    expect(res.status).toBe(401);
  });

  it('serves the route with the token', async () => {
    const res = await api(testApp.server).get('/api/organizations/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('applies the global AllExceptionsFilter', async () => {
    // An unmatched route is a plain NotFoundException. The filter rewrites it
    // into the ApiError envelope; without configureApp() this body would be
    // Nest's default { statusCode, message }.
    const res = await api(testApp.server).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
