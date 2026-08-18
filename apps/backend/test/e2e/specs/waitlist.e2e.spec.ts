import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { createFileDatabase } from '../harness/database';
import { createTestApp, type TestApp } from '../harness/create-test-app';

/**
 * `POST /api/waitlist` against a real Postgres, because both halves of this
 * endpoint live outside ordinary application code: dedupe is the unique index
 * on `marketing.waitlist.email`, and the rate limit is a guard that runs before
 * the body is even parsed.
 */
describe('waitlist signup', () => {
  let db: Kysely<Database>;
  let closeDb: () => Promise<void>;
  let testApp: TestApp;

  const post = (email: string) =>
    request(testApp.server).post('/api/waitlist').send({ email });

  const rows = () => db.selectFrom('marketing.waitlist').selectAll().execute();

  beforeAll(async () => {
    ({ db, close: closeDb } = await createFileDatabase());
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
    await closeDb();
  });

  it('stores a normalized email, treats a repeat as a no-op, then rate limits', async () => {
    await post('  Founder@Example.COM ').expect(201);
    expect(await rows()).toMatchObject([{ email: 'founder@example.com' }]);

    // Same address in a different casing: one row, and the caller cannot tell
    // it was already there.
    await post('FOUNDER@example.com').expect(201);
    expect(await rows()).toHaveLength(1);

    await post('not-an-email').expect(400);

    // Three requests spent so far — the guard counts requests, not stored
    // rows, so the malformed one counts too. Two more fit inside the window of
    // five, and the sixth is refused.
    await post('second@example.com').expect(201);
    await post('third@example.com').expect(201);
    const limited = await post('fourth@example.com').expect(429);
    expect(limited.body.code).toBe('WAITLIST_RATE_LIMITED');
    expect(limited.body.details.retryAfterSeconds).toBeGreaterThan(0);

    // The blocked signup was not stored.
    expect(await rows()).toHaveLength(3);
  });
});
