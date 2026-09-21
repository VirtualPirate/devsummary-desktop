import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { installGithub, type GithubFake } from '../fakes/github';
import { daysAgo, defineWorld } from '../fakes/world';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

/** Two repositories, so "one tracked, one not" is a real state here. */
const world = defineWorld({
  repositories: [
    {
      githubId: 900123,
      name: 'api',
      fullName: 'octo-e2e/api',
      branch: 'main',
      private: false,
      commits: [
        { sha: 'sha-a', message: 'feat: a', at: daysAgo(2), parents: 1 },
      ],
    },
    {
      githubId: 900124,
      name: 'web',
      fullName: 'octo-e2e/web',
      branch: 'main',
      private: false,
      commits: [],
    },
  ],
});

describe('choosing the branch each repository is read on', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let github: GithubFake;
  let apiRepoId: string;
  let webRepoId: string;

  beforeAll(async () => {
    // Connecting is gated on a configured AI provider; this file is about the
    // branch choice that follows it.
    process.env.OPENAI_API_KEY = 'sk-e2e';
    github = await installGithub(world);
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);

    const res = await api(testApp.server)
      .post('/api/integrations/github/token')
      .send({ token: 'github_pat_e2e' })
      .expect(201);
    const repos = res.body.data.repositories as Array<{
      id: string;
      fullName: string;
    }>;
    apiRepoId = repos.find((r) => r.fullName === 'octo-e2e/api')!.id;
    webRepoId = repos.find((r) => r.fullName === 'octo-e2e/web')!.id;
    await waitForJobs(db);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('lists branches live from GitHub rather than from our tables', async () => {
    const res = await api(testApp.server)
      .get(`/api/integrations/github/repositories/${apiRepoId}/branches`)
      .expect(200);
    expect(res.body.data.defaultBranch).toBe('main');
    expect(
      (res.body.data.branches as Array<{ name: string }>).map((b) => b.name),
    ).toEqual(['main']);
    // Live means it asked. The route table answers branches over GraphQL.
    expect(github.calls.some((c) => c.route === 'POST /graphql')).toBe(true);
  });

  it('404s for a repository id that is not in this workspace', async () => {
    const res = await api(testApp.server)
      .get(
        '/api/integrations/github/repositories/00000000-0000-4000-8000-000000000000/branches',
      )
      .expect(404);
    expect(res.body.code).toBe('GITHUB_REPOSITORY_NOT_FOUND');
  });

  it('reports no tracked repository before a branch is chosen', async () => {
    const res = await api(testApp.server)
      .get('/api/integrations/github/repositories/ingest-status')
      .expect(200);
    expect(res.body.data.repositories).toEqual([]);
    expect(res.body.data.ingesting).toBe(false);
  });

  it('starts one ingest per selected repository', async () => {
    const res = await api(testApp.server)
      .post('/api/integrations/github/repositories/branches')
      .send({
        lookbackDays: 30,
        selections: [{ repositoryId: apiRepoId, branch: 'main' }],
      })
      .expect(202);

    expect(res.body.data.started).toBe(1);
    expect(res.body.data.jobIds).toHaveLength(1);
    await waitForJobs(db);
  });

  it('refuses a second branch for a repository already tracked, with 409', async () => {
    const res = await api(testApp.server)
      .post('/api/integrations/github/repositories/branches')
      .send({
        lookbackDays: 30,
        selections: [{ repositoryId: apiRepoId, branch: 'develop' }],
      })
      .expect(409);

    expect(res.body.code).toBe('GITHUB_REPOSITORY_BRANCHES_LOCKED');

    const tracked = await db
      .selectFrom('github.repositoryBranches')
      .select('branch')
      .where('repositoryId', '=', apiRepoId)
      .where('deletedAt', 'is', null)
      .execute();
    expect(tracked.map((r) => r.branch)).toEqual(['main']);
  });

  it('lists only the tracked repository in ingest-status, with its counts', async () => {
    const res = await api(testApp.server)
      .get('/api/integrations/github/repositories/ingest-status')
      .expect(200);

    const rows = res.body.data.repositories as Array<{
      repositoryId: string;
      fullName: string;
      branch: string;
      commitCount: number;
      processedCount: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].repositoryId).toBe(apiRepoId);
    expect(rows[0].branch).toBe('main');
    expect(rows[0].commitCount).toBe(1);
    expect(rows[0].processedCount).toBe(1);
    // Nothing is running: the jobs table drained above.
    expect(res.body.data.ingesting).toBe(false);
    // The untracked repository is absent rather than reported as idle.
    expect(rows.some((r) => r.repositoryId === webRepoId)).toBe(false);
  });

  it('tracks the second repository on its own branch', async () => {
    await api(testApp.server)
      .post('/api/integrations/github/repositories/branches')
      .send({
        lookbackDays: 30,
        selections: [{ repositoryId: webRepoId, branch: 'main' }],
      })
      .expect(202);
    await waitForJobs(db);

    const res = await api(testApp.server)
      .get('/api/integrations/github/repositories/ingest-status')
      .expect(200);
    expect(res.body.data.repositories).toHaveLength(2);
  });

  it('drains the jobs table', async () => {
    // A 60s dispatcher tick can enqueue `briefs.dispatchDue` after boot; wait
    // it out so "drained" means empty rather than racing that row.
    await waitForJobs(db);
    expect(await db.selectFrom('jobs').selectAll().execute()).toEqual([]);
  });
});
