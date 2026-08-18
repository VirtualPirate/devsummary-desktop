import { sql, type Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { createFileDatabase } from '../harness/database';
import { createTestApp, type TestApp } from '../harness/create-test-app';

describe('vitest ESM support', () => {
  it('imports the real better-auth package, not a mock', async () => {
    const mod = await import('better-auth');
    expect(typeof mod.betterAuth).toBe('function');
  });

  it('imports the real better-auth/api entry point', async () => {
    const mod = await import('better-auth/api');
    expect(typeof mod.createAuthMiddleware).toBe('function');
    expect(typeof mod.APIError).toBe('function');
  });

  it('imports the real better-auth/plugins entry point', async () => {
    const mod = await import('better-auth/plugins');
    expect(typeof mod.emailOTP).toBe('function');
    expect(typeof mod.openAPI).toBe('function');
  });
});

describe('template database', () => {
  let db: Kysely<Database>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createFileDatabase());
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

  it('has the core tables and starts empty', async () => {
    // Cast to ::int deliberately. count(*) is int8, and kysely.module.ts sets a
    // process-wide pg type parser mapping int8 to BigInt, so an un-cast count
    // arrives as 0n and fails toBe(0). int4 is always a JS number.
    const users = await sql<{ n: number }>`
      select count(*)::int as n from auth."user"
    `.execute(db);
    const orgs = await sql<{ n: number }>`
      select count(*)::int as n from public.organizations
    `.execute(db);
    expect(users.rows[0].n).toBe(0);
    expect(orgs.rows[0].n).toBe(0);
  });

  it('exposes the camelCase Kysely surface the app uses', async () => {
    // Proves CamelCasePlugin is wired: 'auth.user' + 'emailVerified' only
    // resolve if the plugin rewrites them to auth.user / email_verified.
    const row = await db
      .selectFrom('auth.user')
      .select(['id', 'emailVerified'])
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });
});

describe('app harness', () => {
  let testApp: TestApp;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    ({ close: closeDb } = await createFileDatabase());
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
    await closeDb();
  });

  it('serves the anonymous liveness route', async () => {
    const res = await request(testApp.server).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('protects a route that has no @AllowAnonymous', async () => {
    // AuthGuard is registered as a global APP_GUARD by
    // @thallesp/nestjs-better-auth and throws UnauthorizedException when there
    // is no session; anything without @AllowAnonymous is protected by default.
    const res = await request(testApp.server).get('/api/organizations/me');
    expect(res.status).toBe(401);
  });

  it('applies the global AllExceptionsFilter', async () => {
    // An unmatched route is a plain NotFoundException. The filter rewrites it
    // into the ApiError envelope; without configureApp() this body would be
    // Nest's default { statusCode, message }.
    const res = await request(testApp.server).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});
