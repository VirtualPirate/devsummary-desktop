import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { daysAgo, installFakes, seedWorld, type Fakes } from '../fakes';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

describe('what the app reports about its own background work', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let fakes: Fakes;
  let repositoryId: string;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'sk-e2e';
    fakes = await installFakes();
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);
  });

  afterAll(async () => {
    await fakes.teardown();
    await testApp.close();
  });

  it('reports nothing active before anything is connected', async () => {
    const res = await api(testApp.server)
      .get('/api/organizations/current/jobs/activity')
      .expect(200);
    expect(res.body.data).toEqual({
      active: false,
      fetching: 0,
      analyzing: 0,
      generating: 0,
    });
  });

  it('returns an empty commit-activity series with no commits', async () => {
    const res = await api(testApp.server)
      .get('/api/organizations/current/analytics/commit-activity')
      .query({
        from: daysAgo(7).toISOString(),
        to: new Date().toISOString(),
        granularity: 'day',
      })
      .expect(200);
    // AnalyticsService zero-fills every bucket in the half-open [from, to)
    // via enumerateBucketKeys — an empty range is N points of commits: 0,
    // not points: [].
    expect(res.body.data.points.length).toBeGreaterThan(0);
    expect(
      (res.body.data.points as Array<{ commits: number }>).every(
        (p) => Number(p.commits) === 0,
      ),
    ).toBe(true);
  });

  it('rejects a range whose end precedes its start', async () => {
    await api(testApp.server)
      .get('/api/organizations/current/analytics/commit-activity')
      .query({
        from: new Date().toISOString(),
        to: daysAgo(7).toISOString(),
      })
      .expect(400);
  });

  it('rejects an invalid timezone', async () => {
    await api(testApp.server)
      .get('/api/organizations/current/analytics/commit-activity')
      .query({
        from: daysAgo(7).toISOString(),
        to: new Date().toISOString(),
        timezone: 'Mars/Olympus_Mons',
      })
      .expect(400);
  });

  it('reports fetching while an ingest is genuinely in flight', async () => {
    // Hold the commit list open so the running job is observable, rather than
    // racing a job that finishes in milliseconds.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    fakes.github.on('GET /repos/{owner}/{repo}/commits', async (params) => {
      await held;
      // The override replaces the fake's route table, so after the hold lifts
      // this call still has to return the world's commits. `[]` would make
      // getLatestCommitDate treat the branch as empty and ingest nothing.
      const repo = fakes.world.repositories.find(
        (r) => r.fullName === `${String(params.owner)}/${String(params.repo)}`,
      );
      if (!repo) return [];
      return [...repo.commits]
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .map((commit) => {
          const iso = commit.at.toISOString();
          const person = {
            name: fakes.world.author.name,
            email: fakes.world.author.email,
            date: iso,
          };
          return {
            sha: commit.sha,
            parents: Array.from({ length: commit.parents }, (_, i) => ({
              sha: `${commit.sha}-p${i}`,
            })),
            commit: {
              author: person,
              committer: person,
              message: commit.message,
            },
            author: {
              id: fakes.world.author.githubId,
              login: fakes.world.author.login,
            },
            committer: {
              id: fakes.world.author.githubId,
              login: fakes.world.author.login,
            },
          };
        });
    });

    const seeding = seedWorld(testApp.server, db, fakes.world);

    await waitFor(async () => {
      const res = await api(testApp.server)
        .get('/api/organizations/current/jobs/activity')
        .expect(200);
      return res.body.data.active === true && res.body.data.fetching > 0;
    });

    release();
    fakes.github.on('GET /repos/{owner}/{repo}/commits', null);
    const ids = await seeding;
    repositoryId = ids['octo-e2e/api'];
    await waitForJobs(db, 60_000);
  }, 120_000);

  it('reports nothing active once the queue has drained', async () => {
    const res = await api(testApp.server)
      .get('/api/organizations/current/jobs/activity')
      .expect(200);
    expect(res.body.data.active).toBe(false);
  });

  it('counts the ingested commits in the activity series', async () => {
    const res = await api(testApp.server)
      .get('/api/organizations/current/analytics/commit-activity')
      .query({
        from: daysAgo(30).toISOString(),
        to: new Date().toISOString(),
        granularity: 'day',
        repositoryId,
      })
      .expect(200);

    const total = (res.body.data.points as Array<{ commits: number }>).reduce(
      (sum, p) => sum + Number(p.commits),
      0,
    );
    expect(total).toBe(2);
  });

  it('buckets by week when asked to', async () => {
    const res = await api(testApp.server)
      .get('/api/organizations/current/analytics/commit-activity')
      .query({
        from: daysAgo(30).toISOString(),
        to: new Date().toISOString(),
        granularity: 'week',
      })
      .expect(200);
    expect(res.body.data.points.length).toBeGreaterThan(0);
    expect(res.body.data.points.length).toBeLessThan(10);
  });

  it('drains the jobs table', async () => {
    // A 60s dispatcher tick can enqueue `briefs.dispatchDue` after boot; wait
    // it out so "drained" means empty rather than racing that row.
    await waitForJobs(db);
    expect(await db.selectFrom('jobs').selectAll().execute()).toEqual([]);
  });
});

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('condition never held');
    await new Promise((r) => setTimeout(r, 50));
  }
}
