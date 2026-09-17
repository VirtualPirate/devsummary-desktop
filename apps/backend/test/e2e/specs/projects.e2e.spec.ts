import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { installGithub } from '../fakes/github';
import { installLlm } from '../fakes/llm';
import { daysAgo, defineWorld, seedWorld } from '../fakes/world';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

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
      commits: [
        { sha: 'sha-b', message: 'feat: b', at: daysAgo(2), parents: 1 },
      ],
    },
  ],
});

describe('projects: the repository scope a brief is generated over', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let apiRepoId: string;
  let webRepoId: string;
  let projectId: string;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'sk-e2e';
    await installGithub(world);
    await installLlm();
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);
    const ids = await seedWorld(testApp.server, db, world);
    apiRepoId = ids['octo-e2e/api'];
    webRepoId = ids['octo-e2e/web'];
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('starts with no project', async () => {
    const res = await api(testApp.server)
      .get('/api/organizations/current/projects')
      .expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('creates a project scoped to one repository', async () => {
    const res = await api(testApp.server)
      .post('/api/organizations/current/projects')
      .send({
        name: 'Platform',
        description: 'The API surface',
        color: '#ff8800',
        repositoryIds: [apiRepoId],
      })
      .expect(201);

    projectId = res.body.data.id as string;
    expect(res.body.data.name).toBe('Platform');
    expect(res.body.data.repositoryIds).toEqual([apiRepoId]);
  });

  it('rejects a nameless project', async () => {
    await api(testApp.server)
      .post('/api/organizations/current/projects')
      .send({ name: '', repositoryIds: [] })
      .expect(400);
  });

  it('rejects a repository id that is not in this workspace', async () => {
    const res = await api(testApp.server)
      .post('/api/organizations/current/projects')
      .send({
        name: 'Foreign',
        repositoryIds: ['00000000-0000-4000-8000-000000000000'],
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('reads one project back', async () => {
    const res = await api(testApp.server)
      .get(`/api/organizations/current/projects/${projectId}`)
      .expect(200);
    expect(res.body.data).toMatchObject({
      id: projectId,
      name: 'Platform',
      color: '#ff8800',
    });
  });

  it('404s an unknown project', async () => {
    const res = await api(testApp.server)
      .get(
        '/api/organizations/current/projects/00000000-0000-4000-8000-000000000000',
      )
      .expect(404);
    expect(res.body.code).toBe('PROJECT_NOT_FOUND');
  });

  it('renames a project and clears its description', async () => {
    const res = await api(testApp.server)
      .patch(`/api/organizations/current/projects/${projectId}`)
      .send({ name: 'Platform Core', description: null })
      .expect(200);
    expect(res.body.data.name).toBe('Platform Core');
    expect(res.body.data.description).toBeNull();
  });

  it('replaces the repository set wholesale', async () => {
    const res = await api(testApp.server)
      .put(`/api/organizations/current/projects/${projectId}/repositories`)
      .send({ repositoryIds: [apiRepoId, webRepoId] })
      .expect(200);
    expect(new Set(res.body.data.repositoryIds)).toEqual(
      new Set([apiRepoId, webRepoId]),
    );

    const narrowed = await api(testApp.server)
      .put(`/api/organizations/current/projects/${projectId}/repositories`)
      .send({ repositoryIds: [webRepoId] })
      .expect(200);
    expect(narrowed.body.data.repositoryIds).toEqual([webRepoId]);
  });

  it('keeps a generated brief readable after the project is deleted', async () => {
    const generated = await api(testApp.server)
      .post('/api/organizations/current/briefs/generate')
      .send({ scope: { type: 'project', projectId } })
      .expect(202);
    const briefId = generated.body.data.briefId as string;
    await waitForJobs(db, 60_000);

    await api(testApp.server)
      .delete(`/api/organizations/current/projects/${projectId}`)
      .expect(204);

    const list = await api(testApp.server)
      .get('/api/organizations/current/projects')
      .expect(200);
    expect(list.body.data).toEqual([]);

    // Soft delete: the history the project produced does not disappear with it.
    const brief = await api(testApp.server)
      .get(`/api/organizations/current/briefs/${briefId}`)
      .expect(200);
    expect(brief.body.data.id).toBe(briefId);
  }, 60_000);

  it('drains the jobs table', async () => {
    // A 60s dispatcher tick can enqueue `briefs.dispatchDue` after boot; wait
    // it out so "drained" means empty rather than racing that row.
    await waitForJobs(db);
    expect(await db.selectFrom('jobs').selectAll().execute()).toEqual([]);
  });
});
