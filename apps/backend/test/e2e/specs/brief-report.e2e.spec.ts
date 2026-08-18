import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { createFileDatabase } from '../harness/database';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createVerifiedUser } from '../harness/auth-client';

const PASSWORD = 'correct-horse-battery-staple';
const PERIOD_START = new Date('2026-08-02T00:00:00Z');
const PERIOD_END = new Date('2026-08-09T00:00:00Z');

describe('GET /api/organizations/current/briefs/:briefId/report', () => {
  let testApp: TestApp;
  let db: Kysely<Database>;
  let closeDb: () => Promise<void>;

  let orgId: string;
  let cookie: string;
  let otherOrgId: string;
  let otherCookie: string;
  let briefId: string;
  let repoId: string;

  beforeAll(async () => {
    ({ db, close: closeDb } = await createFileDatabase());
    testApp = await createTestApp();

    const owner = await createVerifiedUser(testApp.server, db, {
      email: 'report-owner@example.com',
      password: PASSWORD,
      name: 'Report Owner',
    });
    cookie = owner.cookie;
    orgId = (
      await request(testApp.server)
        .post('/api/organizations')
        .set('Cookie', cookie)
        .send({ name: 'Report Org' })
    ).body.data.id as string;

    const outsider = await createVerifiedUser(testApp.server, db, {
      email: 'report-outsider@example.com',
      password: PASSWORD,
      name: 'Report Outsider',
    });
    otherCookie = outsider.cookie;
    otherOrgId = (
      await request(testApp.server)
        .post('/api/organizations')
        .set('Cookie', otherCookie)
        .send({ name: 'Other Org' })
    ).body.data.id as string;

    const installation = await db
      .insertInto('github.installations')
      .values({
        organizationId: orgId,
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

    // sha, parentCount, authoredAt, commit type. The merge commit and the
    // previous-period commit are the two rows the assertions hinge on.
    const seed: Array<[string, number, string, string | null]> = [
      ['aaa1', 1, '2026-08-03T10:00:00Z', 'feature'],
      ['aaa2', 1, '2026-08-04T10:00:00Z', 'docs'],
      ['aaa3', 1, '2026-08-05T10:00:00Z', 'chore'],
      ['merge', 2, '2026-08-05T11:00:00Z', 'feature'],
      ['prev1', 1, '2026-07-28T10:00:00Z', 'feature'],
    ];

    for (const [sha, parentCount, authoredAt, commitType] of seed) {
      const commit = await db
        .insertInto('github.commits')
        .values({
          repositoryId: repo.id,
          sha,
          parentCount,
          message: `commit ${sha}`,
          authorGithubUserId: 99n,
          authorGithubLogin: 'priya',
          authorName: 'Priya',
          authorEmail: 'priya@acme.test',
          committerGithubUserId: 99n,
          committerGithubLogin: 'priya',
          committerName: 'Priya',
          committerEmail: 'priya@acme.test',
          authoredAt: new Date(authoredAt),
          committedAt: new Date(authoredAt),
          raw: JSON.stringify({}),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await db
        .insertInto('github.commitAnalyses')
        .values({
          commitId: commit.id,
          status: 'analyzed',
          commitType: commitType as never,
          summary: `summary ${sha}`,
          diffWasTruncated: false,
          additions: 100,
          deletions: 10,
        })
        .execute();
    }

    repoId = repo.id;

    briefId = (
      await db
        .insertInto('briefs.briefs')
        .values({
          organizationId: orgId,
          scopeType: 'repository',
          scopeRepositoryId: repo.id,
          periodStart: PERIOD_START,
          periodEnd: PERIOD_END,
          status: 'delivered',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await testApp.close();
    await closeDb();
  });

  it('excludes merge commits so totals match the brief scope', async () => {
    const res = await request(testApp.server)
      .get(`/api/organizations/current/briefs/${briefId}/report`)
      .set('Cookie', cookie)
      .set('X-Organization-Id', orgId)
      .expect(200);

    const report = res.body.data;
    // Three in-period commits with parent_count = 1. The merge commit and the
    // previous-period commit must not appear in this total.
    expect(report.totals.commits).toBe(3);
    expect(report.totals.repositoriesTouched).toBe(1);
    expect(report.totals.repositoriesInScope).toBe(1);
    expect(report.locCoverage).toEqual({ withLoc: 3, total: 3 });
  });

  it('zero-fills the period and folds docs and chore into upkeep', async () => {
    const res = await request(testApp.server)
      .get(`/api/organizations/current/briefs/${briefId}/report`)
      .set('Cookie', cookie)
      .set('X-Organization-Id', orgId)
      .expect(200);

    const report = res.body.data;
    expect(report.daily).toHaveLength(7);
    expect(report.daily[0].date).toBe('2026-08-02');
    expect(report.workBreakdown).toEqual([
      { category: 'upkeep', commits: 2 },
      { category: 'feature', commits: 1 },
    ]);
  });

  it('compares against the previous period', async () => {
    const res = await request(testApp.server)
      .get(`/api/organizations/current/briefs/${briefId}/report`)
      .set('Cookie', cookie)
      .set('X-Organization-Id', orgId)
      .expect(200);

    // One commit the week before, three this week: +200%.
    expect(res.body.data.deltas.commits).toBeCloseTo(2);
  });

  // `Asia/Calcutta` is a legacy tzdata alias. Every JS runtime accepts it, and
  // schedules really do store it, but a Postgres built without `tzdata-legacy`
  // does not know the name — passing it into `at time zone` raised "time zone
  // not recognized" and 500'd the whole report. Day boundaries are resolved in
  // JS now, so no query names a zone at all.
  it('reports on a schedule stored with a legacy timezone alias', async () => {
    const schedule = await db
      .insertInto('briefs.briefSchedules')
      .values({
        organizationId: orgId,
        name: 'Legacy zone',
        cadenceType: 'weekly',
        cadenceTime: '09:00',
        cadenceDayOfWeek: 1,
        timezone: 'Asia/Calcutta',
        scopeType: 'repository',
        scopeRepositoryId: repoId,
        nextRunAt: new Date('2026-08-10T03:30:00Z'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const scoped = await db
      .insertInto('briefs.briefs')
      .values({
        organizationId: orgId,
        briefScheduleId: schedule.id,
        scopeType: 'repository',
        scopeRepositoryId: repoId,
        // Local midnights in +05:30, the shape computePeriod produces: start
        // inclusive, end exclusive (Aug 9 00:00 IST).
        periodStart: new Date('2026-08-01T18:30:00Z'),
        periodEnd: new Date('2026-08-08T18:30:00Z'),
        // The zone is snapshotted on the brief, not read back off the schedule
        // (which is editable and would re-tile this period after an edit).
        periodTimezone: 'Asia/Calcutta',
        // Snapshotted for the same reason: the report re-queries live, so the
        // clock it bounds on has to be the one the brief was generated with.
        commitClock: 'committed',
        status: 'delivered',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const res = await request(testApp.server)
      .get(`/api/organizations/current/briefs/${scoped.id}/report`)
      .set('Cookie', cookie)
      .set('X-Organization-Id', orgId)
      .expect(200);

    const report = res.body.data;
    expect(report.timezone).toBe('Asia/Calcutta');
    expect(report.daily).toHaveLength(7);
    expect(report.daily[0].date).toBe('2026-08-02');
    // Commits sit on Aug 3–5 UTC, all comfortably inside the +05:30 days.
    expect(report.totals.commits).toBe(3);
    expect(report.totals.linesAdded).toBe(300);
    expect(report.totals.contributors).toBe(1);
  });

  it('returns 404 for a brief in another organization', async () => {
    await request(testApp.server)
      .get(`/api/organizations/current/briefs/${briefId}/report`)
      .set('Cookie', otherCookie)
      .set('X-Organization-Id', otherOrgId)
      .expect(404);
  });
});
