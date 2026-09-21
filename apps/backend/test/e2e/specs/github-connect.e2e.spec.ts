import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { installGithub, type GithubFake } from '../fakes/github';
import { defineWorld } from '../fakes/world';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

describe('connecting GitHub with a fine-grained PAT', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let github: GithubFake;
  const world = defineWorld();

  beforeAll(async () => {
    github = await installGithub(world);
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('reports no installation before anything is connected', async () => {
    const res = await api(testApp.server)
      .get('/api/integrations/github')
      .expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('refuses a PAT until an AI provider is configured', async () => {
    const refused = await api(testApp.server)
      .post('/api/integrations/github/token')
      .send({ token: 'github_pat_e2e' })
      .expect(400);
    expect(refused.body.code).toBe('AI_NOT_CONFIGURED');

    // Connecting is what starts ingest, and every commit it reads is analysed —
    // so the rest of this file runs with a provider configured, as a real
    // install does by the time it reaches this screen.
    await api(testApp.server)
      .put('/api/local-settings/credentials')
      .send({ openaiApiKey: 'sk-e2e' })
      .expect(200);
  });

  it('refuses a token GitHub rejects, with the API reason attached', async () => {
    github.failNext('GET /user', 401, 'Bad credentials');
    const res = await api(testApp.server)
      .post('/api/integrations/github/token')
      .send({ token: 'github_pat_expired' })
      .expect(400);
    expect(res.body.code).toBe('BAD_REQUEST');
    expect(res.body.message).toContain('GET /user');
  });

  it('refuses a token that grants no repository', async () => {
    // Authenticates fine, lists nothing: the "Repository access" mistake, which
    // has its own code precisely so the user is not sent to check expiry.
    github.on('GET /user/repos', () => []);
    const res = await api(testApp.server)
      .post('/api/integrations/github/token')
      .send({ token: 'github_pat_no_grants' })
      .expect(400);
    expect(res.body.code).toBe('GITHUB_TOKEN_GRANTS_NO_REPOS');
    github.on('GET /user/repos', null);
  });

  it('connects and reconciles the repositories the token grants', async () => {
    const res = await api(testApp.server)
      .post('/api/integrations/github/token')
      .send({ token: 'github_pat_e2e' })
      .expect(201);

    expect(res.body.data.accountLogin).toBe(world.accountLogin);
    expect(res.body.data.repositories).toHaveLength(1);
    expect(res.body.data.repositories[0].fullName).toBe('octo-e2e/api');
    // Inert until a branch is chosen.
    expect(res.body.data.repositories[0].branch).toBeNull();
    await waitForJobs(db);
  });

  it('excludes a repository the token can list but not read', async () => {
    // `GET /user/repos` enumerates by account affiliation regardless of the
    // token; the grant probe is `/collaborators` (metadata=read), and a 403
    // there means "listed, not granted".
    github.failNext(
      'GET /repos/{owner}/{repo}/collaborators',
      403,
      'Resource not accessible',
    );
    const res = await api(testApp.server)
      .post(
        '/api/integrations/github/installations/' +
          (await installationId(db)) +
          '/sync',
      )
      .expect(201);
    expect(res.body.data.repositories).toHaveLength(0);
  });

  it('restores the repository on the next sync once the grant is back', async () => {
    const res = await api(testApp.server)
      .post(
        '/api/integrations/github/installations/' +
          (await installationId(db)) +
          '/sync',
      )
      .expect(201);
    expect(
      res.body.data.repositories.map((r: { fullName: string }) => r.fullName),
    ).toEqual(['octo-e2e/api']);
  });

  it('reports github: true from the settings status route', async () => {
    const res = await api(testApp.server)
      .get('/api/local-settings')
      .expect(200);
    expect(res.body.data.github).toBe(true);
  });

  it('disconnects, and reports disconnected afterwards', async () => {
    await api(testApp.server).delete('/api/integrations/github').expect(204);

    const status = await api(testApp.server)
      .get('/api/integrations/github')
      .expect(200);
    expect(status.body.data).toEqual([]);

    const settings = await api(testApp.server)
      .get('/api/local-settings')
      .expect(200);
    expect(settings.body.data.github).toBe(false);
  });

  it('reconnects the same account and revives its rows', async () => {
    const res = await api(testApp.server)
      .post('/api/integrations/github/token')
      .send({ token: 'github_pat_e2e_rotated' })
      .expect(201);
    expect(res.body.data.repositories).toHaveLength(1);
    await waitForJobs(db);
  });

  it('drains the jobs table', async () => {
    // A 60s dispatcher tick can enqueue `briefs.dispatchDue` after boot; wait
    // it out so "drained" means empty rather than racing that row.
    await waitForJobs(db);
    expect(await db.selectFrom('jobs').selectAll().execute()).toEqual([]);
  });
});

async function installationId(db: Kysely<Database>): Promise<string> {
  const row = await db
    .selectFrom('github.installations')
    .select('id')
    .where('deletedAt', 'is', null)
    .executeTakeFirstOrThrow();
  return row.id;
}
