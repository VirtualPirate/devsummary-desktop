import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { LOCAL_ORG_ID } from '../../../src/local/local-identity';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';

/**
 * The heatmap query is the only place the backend asks Postgres for
 * `extract(isodow from … at time zone …)`. PGlite is Postgres in WASM, so this
 * spec is what proves that clause parses, runs, and buckets in the *requested*
 * zone rather than the process zone (which `main.ts` pins to UTC).
 */
describe('GET /api/organizations/current/analytics/commit-hours', () => {
  let testApp: TestApp;
  let db: Kysely<Database>;

  beforeAll(async () => {
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);

    const installation = await db
      .insertInto('github.installations')
      .values({
        organizationId: LOCAL_ORG_ID,
        githubInstallationId: 1n,
        githubAccountId: 1n,
        githubAccountLogin: 'acme',
        githubAccountType: 'Organization',
        targetType: 'Organization',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const repo = await db
      .insertInto('github.repositories')
      .values({
        installationId: installation.id,
        githubRepoId: 10n,
        name: 'checkout-web',
        fullName: 'acme/checkout-web',
        private: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Monday 15:30 IST, twice, plus one that crosses into Tuesday 01:30 IST.
    const authoredAt = [
      '2026-08-03T10:00:00Z',
      '2026-08-03T10:15:00Z',
      '2026-08-03T20:00:00Z',
    ];

    for (const [i, at] of authoredAt.entries()) {
      await db
        .insertInto('github.commits')
        .values({
          repositoryId: repo.id,
          sha: `aaa${i}`,
          parentCount: 1,
          message: `commit ${i}`,
          authorGithubUserId: 99n,
          authorGithubLogin: 'priya',
          authorName: 'Priya',
          authorEmail: 'priya@acme.test',
          committerGithubUserId: 99n,
          committerGithubLogin: 'priya',
          committerName: 'Priya',
          committerEmail: 'priya@acme.test',
          authoredAt: new Date(at),
          committedAt: new Date(at),
          raw: JSON.stringify({}),
        })
        .execute();
    }
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('buckets commits by weekday and hour in the requested timezone', async () => {
    const res = await api(testApp.server)
      .get('/api/organizations/current/analytics/commit-hours')
      .query({
        from: '2026-08-03T00:00:00Z',
        to: '2026-08-10T00:00:00Z',
        timezone: 'Asia/Kolkata',
      })
      .expect(200);

    // weekday is 0 = Monday, so the +05:30 shift moves the 20:00Z commit to
    // Tuesday 01:30 — a different row from the two at Monday 15:30.
    expect(res.body.data.cells).toEqual([
      { weekday: 0, hour: 15, commits: 2 },
      { weekday: 1, hour: 1, commits: 1 },
    ]);
    expect(res.body.data.range).toEqual({
      from: '2026-08-03T00:00:00Z',
      to: '2026-08-10T00:00:00Z',
      timezone: 'Asia/Kolkata',
    });
  });
});
