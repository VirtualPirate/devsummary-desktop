import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { createFileDatabase } from '../harness/database';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createVerifiedUser } from '../harness/auth-client';
import { seedMember } from '../harness/fixtures';

const PASSWORD = 'correct-horse-battery-staple';

describe('OrgContextGuard', () => {
  let testApp: TestApp;
  let db: Kysely<Database>;
  let closeDb: () => Promise<void>;

  let orgId: string;
  let ownerCookie: string;
  let adminCookie: string;
  let viewerCookie: string;
  let outsiderCookie: string;

  beforeAll(async () => {
    ({ db, close: closeDb } = await createFileDatabase());
    testApp = await createTestApp();

    const owner = await createVerifiedUser(testApp.server, db, {
      email: 'guard-owner@example.com',
      password: PASSWORD,
      name: 'Guard Owner',
    });
    ownerCookie = owner.cookie;

    const created = await request(testApp.server)
      .post('/api/organizations')
      .set('Cookie', ownerCookie)
      .send({ name: 'Guard Org' });
    orgId = created.body.data.id as string;

    const admin = await createVerifiedUser(testApp.server, db, {
      email: 'guard-admin@example.com',
      password: PASSWORD,
      name: 'Guard Admin',
    });
    adminCookie = admin.cookie;
    await seedMember(db, {
      organizationId: orgId,
      userId: admin.userId,
      role: 'admin',
    });

    const viewer = await createVerifiedUser(testApp.server, db, {
      email: 'guard-viewer@example.com',
      password: PASSWORD,
      name: 'Guard Viewer',
    });
    viewerCookie = viewer.cookie;
    await seedMember(db, {
      organizationId: orgId,
      userId: viewer.userId,
      role: 'viewer',
    });

    const outsider = await createVerifiedUser(testApp.server, db, {
      email: 'guard-outsider@example.com',
      password: PASSWORD,
      name: 'Guard Outsider',
    });
    outsiderCookie = outsider.cookie;
  });

  afterAll(async () => {
    await testApp.close();
    await closeDb();
  });

  it('requires the x-organization-id header', async () => {
    const res = await request(testApp.server)
      .get('/api/organizations/current')
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'ORG_HEADER_REQUIRED' });
  });

  it('rejects a malformed x-organization-id as a bad header, not a 500', async () => {
    // The guard parses the header with z.uuid() before it reaches the
    // repository. Without that, a non-UUID value hits the uuid column and
    // Postgres raises 22P02, which the exception filter can only render as a
    // 500 — leaking a database error shape through the tenant boundary.
    const res = await request(testApp.server)
      .get('/api/organizations/current')
      .set('Cookie', ownerCookie)
      .set('x-organization-id', 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'ORG_HEADER_REQUIRED' });
  });

  it('requires a session even when the header is valid', async () => {
    const res = await request(testApp.server)
      .get('/api/organizations/current')
      .set('x-organization-id', orgId);
    // AuthGuard throws UnauthorizedException; AppError.UNAUTHENTICATED is also
    // 401, so this holds whichever global guard runs first.
    expect(res.status).toBe(401);
  });

  it('hides existence from a non-member: 404, not 403', async () => {
    // A well-formed UUID matters: anything else is rejected by the guard's
    // z.uuid() parse as ORG_HEADER_REQUIRED (covered above) and never reaches
    // the membership lookup this test is about.
    const res = await request(testApp.server)
      .get('/api/organizations/current')
      .set('Cookie', outsiderCookie)
      .set('x-organization-id', randomUUID());
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'ORG_NOT_FOUND' });
  });

  it('hides a real organization from a non-member the same way', async () => {
    const res = await request(testApp.server)
      .get('/api/organizations/current')
      .set('Cookie', outsiderCookie)
      .set('x-organization-id', orgId);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'ORG_NOT_FOUND' });
  });

  it('lets any member read the organization', async () => {
    const res = await request(testApp.server)
      .get('/api/organizations/current')
      .set('Cookie', viewerCookie)
      .set('x-organization-id', orgId);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('viewer');
  });

  it('refuses a viewer on an admin-level route', async () => {
    const res = await request(testApp.server)
      .patch('/api/organizations/current')
      .set('Cookie', viewerCookie)
      .set('x-organization-id', orgId)
      .send({ name: 'Renamed By Viewer' });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'ORG_FORBIDDEN' });
  });

  it('allows an admin on an admin-level route', async () => {
    const res = await request(testApp.server)
      .patch('/api/organizations/current')
      .set('Cookie', adminCookie)
      .set('x-organization-id', orgId)
      .send({ name: 'Renamed By Admin' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed By Admin');
  });

  it('refuses an admin on an owner-level route', async () => {
    const res = await request(testApp.server)
      .delete('/api/organizations/current')
      .set('Cookie', adminCookie)
      .set('x-organization-id', orgId);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'ORG_FORBIDDEN' });
  });

  it('allows the owner on an owner-level route', async () => {
    // Runs last: this deletes the organization the other tests rely on.
    //
    // DELETE is not a bare row delete — OrganizationTeardownService revokes
    // Slack, uninstalls the GitHub App, and terminates the org's running
    // workflows through a Temporal visibility query on OrganizationId. Each
    // step catches and logs its own failures, so the 204 holds even with the
    // integrations unconfigured; it does mean this assertion touches the real
    // Temporal dev server.
    const res = await request(testApp.server)
      .delete('/api/organizations/current')
      .set('Cookie', ownerCookie)
      .set('x-organization-id', orgId);
    expect(res.status).toBe(204);
  });
});
