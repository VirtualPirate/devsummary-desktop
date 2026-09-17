import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { installGithub } from '../fakes/github';
import { installLlm } from '../fakes/llm';
import { defineWorld, seedWorld } from '../fakes/world';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

const world = defineWorld();

describe('teams: the collaborator scope a brief is generated over', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let collaboratorId: string;
  let teamId: string;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'sk-e2e';
    await installGithub(world);
    await installLlm();
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);
    await seedWorld(testApp.server, db, world);

    const collaborators = await api(testApp.server)
      .get('/api/organizations/current/collaborators')
      .expect(200);
    const rows = collaborators.body.data as Array<{
      id: string;
      githubLogin: string | null;
    }>;
    collaboratorId = rows[0].id;
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('discovered the commit author as a collaborator', async () => {
    const res = await api(testApp.server)
      .get('/api/organizations/current/collaborators')
      .expect(200);
    expect((res.body.data as unknown[]).length).toBeGreaterThan(0);
  });

  it('creates a team with a collaborator', async () => {
    const res = await api(testApp.server)
      .post('/api/organizations/current/teams')
      .send({ name: 'Backend', collaboratorIds: [collaboratorId] })
      .expect(201);
    teamId = res.body.data.id as string;
    expect(res.body.data.collaboratorIds).toEqual([collaboratorId]);
  });

  it('rejects a nameless team', async () => {
    await api(testApp.server)
      .post('/api/organizations/current/teams')
      .send({ name: '', collaboratorIds: [] })
      .expect(400);
  });

  it('rejects a collaborator that is not in this workspace', async () => {
    const res = await api(testApp.server)
      .post('/api/organizations/current/teams')
      .send({
        name: 'Foreign',
        collaboratorIds: ['00000000-0000-4000-8000-000000000000'],
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('reads one team back and 404s an unknown one', async () => {
    const found = await api(testApp.server)
      .get(`/api/organizations/current/teams/${teamId}`)
      .expect(200);
    expect(found.body.data.name).toBe('Backend');

    const missing = await api(testApp.server)
      .get(
        '/api/organizations/current/teams/00000000-0000-4000-8000-000000000000',
      )
      .expect(404);
    expect(missing.body.code).toBe('TEAM_NOT_FOUND');
  });

  it('renames a team', async () => {
    const res = await api(testApp.server)
      .patch(`/api/organizations/current/teams/${teamId}`)
      .send({ name: 'Backend Guild' })
      .expect(200);
    expect(res.body.data.name).toBe('Backend Guild');
  });

  it('replaces the collaborator set wholesale', async () => {
    const cleared = await api(testApp.server)
      .put(`/api/organizations/current/teams/${teamId}/collaborators`)
      .send({ collaboratorIds: [] })
      .expect(200);
    expect(cleared.body.data.collaboratorIds).toEqual([]);

    const restored = await api(testApp.server)
      .put(`/api/organizations/current/teams/${teamId}/collaborators`)
      .send({ collaboratorIds: [collaboratorId] })
      .expect(200);
    expect(restored.body.data.collaboratorIds).toEqual([collaboratorId]);
  });

  it('keeps a generated brief readable after the team is deleted', async () => {
    const generated = await api(testApp.server)
      .post('/api/organizations/current/briefs/generate')
      .send({ scope: { type: 'team', teamId } })
      .expect(202);
    const briefId = generated.body.data.briefId as string;
    await waitForJobs(db, 60_000);

    await api(testApp.server)
      .delete(`/api/organizations/current/teams/${teamId}`)
      .expect(204);

    expect(
      (
        await api(testApp.server)
          .get('/api/organizations/current/teams')
          .expect(200)
      ).body.data,
    ).toEqual([]);

    await api(testApp.server)
      .get(`/api/organizations/current/briefs/${briefId}`)
      .expect(200);
  }, 60_000);

  it('drains the jobs table', async () => {
    // A 60s dispatcher tick can enqueue `briefs.dispatchDue` after boot; wait
    // it out so "drained" means empty rather than racing that row.
    await waitForJobs(db);
    expect(await db.selectFrom('jobs').selectAll().execute()).toEqual([]);
  });
});
