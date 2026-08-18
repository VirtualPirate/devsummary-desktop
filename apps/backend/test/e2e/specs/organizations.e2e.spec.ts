import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import {
  LOCAL_ORG_ID,
  LOCAL_ORG_NAME,
  LOCAL_USER_ID,
} from '../../../src/local/local-identity';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';

/**
 * Workspaces on a single-user desktop install (docs/DELTAS.md D-A): org CRUD
 * survives, the sign-in flow that used to gate it does not. Every request runs
 * as the seeded local user, who owns the seeded default workspace and any
 * workspace they create.
 */
describe('organizations', () => {
  let testApp: TestApp;
  let db: Kysely<Database>;

  beforeAll(async () => {
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('rejects creation without the desktop token', async () => {
    const res = await request(testApp.server)
      .post('/api/organizations')
      .send({ name: 'No Token Inc' });
    expect(res.status).toBe(401);
  });

  it('serves the seeded default workspace with no org header at all', async () => {
    const res = await api(testApp.server).get('/api/organizations/current');
    expect(res.status).toBe(200);
    expect(res.body.data.organization.id).toBe(LOCAL_ORG_ID);
    expect(res.body.data.organization.name).toBe(LOCAL_ORG_NAME);
    expect(res.body.data.role).toBe('owner');
  });

  it('creates a workspace and an owner membership for the local user', async () => {
    const res = await api(testApp.server)
      .post('/api/organizations')
      .send({ name: 'Acme Rockets' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Acme Rockets');
    // buildSlug() appends a random 6-hex-char suffix.
    expect(res.body.data.slug).toMatch(/^acme-rockets-[0-9a-f]{6}$/);
    expect(res.body.data.ownerId).toBe(LOCAL_USER_ID);

    const membership = await db
      .selectFrom('organizationMembers')
      .select('role')
      .where('organizationId', '=', res.body.data.id as string)
      .where('userId', '=', LOCAL_USER_ID)
      .executeTakeFirst();
    expect(membership?.role).toBe('owner');
  });

  it('lists both workspaces under /me', async () => {
    const res = await api(testApp.server).get('/api/organizations/me');
    expect(res.status).toBe(200);
    // MyOrganization is { organization, role }, not a flat Organization.
    const names = (res.body.data as Array<{ organization: { name: string } }>)
      .map((m) => m.organization.name)
      .sort();
    expect(names).toEqual(['Acme Rockets', LOCAL_ORG_NAME]);
  });

  it('reads the workspace named by the header, not the default', async () => {
    const mine = await api(testApp.server).get('/api/organizations/me');
    const acme = (
      mine.body.data as Array<{ organization: { id: string; name: string } }>
    ).find((m) => m.organization.name === 'Acme Rockets')!;

    const res = await api(testApp.server, acme.organization.id).get(
      '/api/organizations/current',
    );
    expect(res.status).toBe(200);
    expect(res.body.data.organization.id).toBe(acme.organization.id);
    expect(res.body.data.role).toBe('owner');
  });

  it('renames the current workspace', async () => {
    const res = await api(testApp.server, LOCAL_ORG_ID)
      .patch('/api/organizations/current')
      .send({ name: 'Renamed Workspace' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Workspace');
  });

  it('refuses a slug that another workspace already uses', async () => {
    // ORG_SLUG_CONFLICT is unreachable via POST: buildSlug() appends a random
    // suffix and retries five times on collision. It is only reachable by
    // PATCHing an explicit slug.
    const mine = await api(testApp.server).get('/api/organizations/me');
    const orgs = mine.body.data as Array<{
      organization: { id: string; slug: string; name: string };
    }>;
    const target = orgs.find((m) => m.organization.name === 'Acme Rockets')!;
    const other = orgs.find((m) => m.organization.name !== 'Acme Rockets')!;

    const res = await api(testApp.server, target.organization.id)
      .patch('/api/organizations/current')
      .send({ slug: other.organization.slug });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ORG_SLUG_CONFLICT' });
  });

  it('deletes a workspace and drops it from /me', async () => {
    // Runs last: teardown soft-deletes the workspace the tests above created.
    const mine = await api(testApp.server).get('/api/organizations/me');
    const acme = (
      mine.body.data as Array<{ organization: { id: string; name: string } }>
    ).find((m) => m.organization.name === 'Acme Rockets')!;

    const res = await api(testApp.server, acme.organization.id).delete(
      '/api/organizations/current',
    );
    expect(res.status).toBe(204);

    const after = await api(testApp.server).get('/api/organizations/me');
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].organization.id).toBe(LOCAL_ORG_ID);
  });
});
