import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { LOCAL_ORG_ID, LOCAL_USER_ID } from '../../../src/local/local-identity';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';

/**
 * The guard still does membership and role work (docs/DELTAS.md D-A) — only
 * the session behind it is now a constant. Roles are exercised by demoting the
 * local user inside a scratch workspace, since there is nobody else to be.
 */
describe('OrgContextGuard', () => {
  let testApp: TestApp;
  let db: Kysely<Database>;
  let scratchOrgId: string;

  const setRole = (role: 'owner' | 'admin' | 'viewer') =>
    db
      .updateTable('organizationMembers')
      // organization_members carries no updated_at column.
      .set({ role })
      .where('organizationId', '=', scratchOrgId)
      .where('userId', '=', LOCAL_USER_ID)
      .execute();

  beforeAll(async () => {
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);

    const created = await api(testApp.server)
      .post('/api/organizations')
      .send({ name: 'Guard Org' });
    scratchOrgId = created.body.data.id as string;
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('rejects before it reads the org header when the token is missing', async () => {
    // LocalTokenGuard is registered on the root module so it runs first: a
    // caller with no token learns nothing about which workspaces exist.
    const res = await request(testApp.server)
      .get('/api/organizations/current')
      .set('x-organization-id', scratchOrgId);
    expect(res.status).toBe(401);
  });

  it('falls back to the default workspace when the header is absent', async () => {
    // A desktop client that has not picked a workspace yet, or an endpoint
    // reached before the switcher loads.
    const res = await api(testApp.server).get('/api/organizations/current');
    expect(res.status).toBe(200);
    expect(res.body.data.organization.id).toBe(LOCAL_ORG_ID);
  });

  it('rejects a malformed x-organization-id as a bad header, not a 500', async () => {
    // The guard parses the header with z.uuid() before it reaches the
    // repository. Without that, a non-UUID value hits the uuid column and
    // Postgres raises 22P02, which the exception filter can only render as a
    // 500 — leaking a database error shape through the workspace boundary.
    const res = await api(testApp.server, 'not-a-uuid').get(
      '/api/organizations/current',
    );
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'ORG_HEADER_REQUIRED' });
  });

  it('hides a workspace that does not exist: 404, not 403', async () => {
    const res = await api(testApp.server, randomUUID()).get(
      '/api/organizations/current',
    );
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'ORG_NOT_FOUND' });
  });

  it('hides a real workspace the user is not a member of, the same way', async () => {
    const orphan = await db
      .insertInto('organizations')
      .values({
        name: 'Someone Else',
        slug: 'someone-else',
        ownerId: LOCAL_USER_ID,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const res = await api(testApp.server, orphan.id).get(
      '/api/organizations/current',
    );
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'ORG_NOT_FOUND' });
  });

  it('lets any member read the workspace', async () => {
    await setRole('viewer');
    const res = await api(testApp.server, scratchOrgId).get(
      '/api/organizations/current',
    );
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('viewer');
  });

  it('refuses a viewer on an admin-level route', async () => {
    await setRole('viewer');
    const res = await api(testApp.server, scratchOrgId)
      .patch('/api/organizations/current')
      .send({ name: 'Renamed By Viewer' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'ORG_FORBIDDEN' });
  });

  it('allows an admin on an admin-level route', async () => {
    await setRole('admin');
    const res = await api(testApp.server, scratchOrgId)
      .patch('/api/organizations/current')
      .send({ name: 'Renamed By Admin' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed By Admin');
  });

  it('refuses an admin on an owner-level route', async () => {
    await setRole('admin');
    const res = await api(testApp.server, scratchOrgId).delete(
      '/api/organizations/current',
    );
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'ORG_FORBIDDEN' });
  });

  it('allows the owner on an owner-level route', async () => {
    // Runs last: this deletes the workspace the other tests rely on.
    //
    // DELETE is not a bare row delete — OrganizationTeardownService revokes
    // Slack, disconnects GitHub, and clears the workspace's queued jobs. Each
    // step catches and logs its own failures, so the 204 holds with the
    // integrations unconfigured.
    await setRole('owner');
    const res = await api(testApp.server, scratchOrgId).delete(
      '/api/organizations/current',
    );
    expect(res.status).toBe(204);
  });
});
