import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { createFileDatabase } from '../harness/database';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createVerifiedUser } from '../harness/auth-client';

const PASSWORD = 'correct-horse-battery-staple';

describe('organizations', () => {
  let testApp: TestApp;
  let db: Kysely<Database>;
  let closeDb: () => Promise<void>;
  let ownerCookie: string;
  let ownerId: string;

  beforeAll(async () => {
    ({ db, close: closeDb } = await createFileDatabase());
    testApp = await createTestApp();
    ({ cookie: ownerCookie, userId: ownerId } = await createVerifiedUser(
      testApp.server,
      db,
      { email: 'org-owner@example.com', password: PASSWORD, name: 'Org Owner' },
    ));
  });

  afterAll(async () => {
    await testApp.close();
    await closeDb();
  });

  it('rejects creation without a session', async () => {
    const res = await request(testApp.server)
      .post('/api/organizations')
      .send({ name: 'No Session Inc' });
    expect(res.status).toBe(401);
  });

  it('creates an organization and an owner membership', async () => {
    const res = await request(testApp.server)
      .post('/api/organizations')
      .set('Cookie', ownerCookie)
      .send({ name: 'Acme Rockets' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Acme Rockets');
    // buildSlug() appends a random 6-hex-char suffix.
    expect(res.body.data.slug).toMatch(/^acme-rockets-[0-9a-f]{6}$/);
    expect(res.body.data.ownerId).toBe(ownerId);

    const membership = await db
      .selectFrom('organizationMembers')
      .select('role')
      .where('organizationId', '=', res.body.data.id as string)
      .where('userId', '=', ownerId)
      .executeTakeFirst();
    expect(membership?.role).toBe('owner');
  });

  it('lists the organization under /me', async () => {
    const res = await request(testApp.server)
      .get('/api/organizations/me')
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // MyOrganization is { organization, role }, not a flat Organization.
    expect(res.body.data[0].organization.name).toBe('Acme Rockets');
    expect(res.body.data[0].role).toBe('owner');
  });

  it('returns the current organization with the caller role', async () => {
    const mine = await request(testApp.server)
      .get('/api/organizations/me')
      .set('Cookie', ownerCookie);
    const orgId = mine.body.data[0].organization.id as string;

    const res = await request(testApp.server)
      .get('/api/organizations/current')
      .set('Cookie', ownerCookie)
      .set('x-organization-id', orgId);

    expect(res.status).toBe(200);
    expect(res.body.data.organization.id).toBe(orgId);
    expect(res.body.data.role).toBe('owner');
  });

  it('refuses a slug that another organization already uses', async () => {
    // ORG_SLUG_CONFLICT is unreachable via POST: buildSlug() appends a random
    // suffix and retries five times on collision. It is only reachable by
    // PATCHing an explicit slug.
    const second = await createVerifiedUser(testApp.server, db, {
      email: 'second-owner@example.com',
      password: PASSWORD,
      name: 'Second Owner',
    });
    const created = await request(testApp.server)
      .post('/api/organizations')
      .set('Cookie', second.cookie)
      .send({ name: 'Rival Corp' });
    expect(created.status).toBe(201);

    const mine = await request(testApp.server)
      .get('/api/organizations/me')
      .set('Cookie', ownerCookie);
    const ownerOrgSlug = mine.body.data[0].organization.slug as string;

    const res = await request(testApp.server)
      .patch('/api/organizations/current')
      .set('Cookie', second.cookie)
      .set('x-organization-id', created.body.data.id)
      .send({ slug: ownerOrgSlug });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ORG_SLUG_CONFLICT' });
  });
});
