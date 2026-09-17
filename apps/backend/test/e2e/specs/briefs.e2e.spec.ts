import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { installGithub } from '../fakes/github';
import { installLlm, type LlmFake } from '../fakes/llm';
import { daysAgo, defineWorld, seedWorld } from '../fakes/world';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

const world = defineWorld();

describe('reading briefs', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let llm: LlmFake;
  let repositoryId: string;
  let projectId: string;
  let firstBriefId: string;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'sk-e2e';
    await installGithub(world);
    llm = await installLlm();
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);

    const ids = await seedWorld(testApp.server, db, world);
    repositoryId = ids['octo-e2e/api'];
    const project = await api(testApp.server)
      .post('/api/organizations/current/projects')
      .send({ name: 'Platform', repositoryIds: [repositoryId] })
      .expect(201);
    projectId = project.body.data.id as string;
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function generate(body: Record<string, unknown>): Promise<string> {
    const res = await api(testApp.server)
      .post('/api/organizations/current/briefs/generate')
      .send(body)
      .expect(202);
    await waitForJobs(db, 60_000);
    return res.body.data.briefId as string;
  }

  it('previews a scope and period before spending a call', async () => {
    const before = llm.calls.length;
    const res = await api(testApp.server)
      .get('/api/organizations/current/briefs/preview')
      .query({
        scopeType: 'project',
        scopeProjectId: projectId,
        periodStart: daysAgo(7).toISOString(),
        periodEnd: new Date().toISOString(),
      })
      .expect(200);

    expect(res.body.data.commits).toBe(2);
    expect(res.body.data.analyzed).toBe(2);
    expect(res.body.data.contributors).toBe(1);
    // A preview is a count, not a generation.
    expect(llm.calls.length).toBe(before);
  });

  it('rejects a preview whose scope id does not match its scopeType', async () => {
    await api(testApp.server)
      .get('/api/organizations/current/briefs/preview')
      .query({
        scopeType: 'project',
        scopeTeamId: projectId,
        periodStart: daysAgo(7).toISOString(),
        periodEnd: new Date().toISOString(),
      })
      .expect(400);
  });

  it('generates a brief over the project scope', async () => {
    llm.brief({
      title: 'Platform week',
      summary: 'Two commits landed.',
      highlights: [
        {
          title: 'Widget endpoint',
          detail: 'Two commits landed on the widget endpoint.',
          category: 'feature',
        },
      ],
    });
    firstBriefId = await generate({ scope: { type: 'project', projectId } });

    const res = await api(testApp.server)
      .get(`/api/organizations/current/briefs/${firstBriefId}`)
      .expect(200);
    expect(res.body.data.title).toBe('Platform week');
    expect(res.body.data.commitCount).toBe(2);
    expect(res.body.data.status).toBe('generated');
  }, 60_000);

  it('lists the brief’s commits, newest first', async () => {
    const res = await api(testApp.server)
      .get(`/api/organizations/current/briefs/${firstBriefId}/commits`)
      .expect(200);
    const shas = (res.body.data.items as Array<{ sha: string }>).map(
      (c) => c.sha,
    );
    expect(shas).toEqual(['sha-newer', 'sha-older']);
  });

  it('pages the brief’s commits with a cursor', async () => {
    const first = await api(testApp.server)
      .get(`/api/organizations/current/briefs/${firstBriefId}/commits`)
      .query({ limit: 1 })
      .expect(200);
    expect(first.body.data.items).toHaveLength(1);
    expect(first.body.data.nextCursor).toBeTruthy();

    const second = await api(testApp.server)
      .get(`/api/organizations/current/briefs/${firstBriefId}/commits`)
      .query({ limit: 1, cursor: first.body.data.nextCursor })
      .expect(200);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].sha).not.toBe(
      first.body.data.items[0].sha,
    );
  });

  it('writes a no-activity brief for a period with no commits', async () => {
    const quietStart = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const quietEnd = new Date(Date.now() - 390 * 24 * 60 * 60 * 1000);
    const before = llm.calls.length;

    const briefId = await generate({
      scope: { type: 'project', projectId },
      periodStart: quietStart.toISOString(),
      periodEnd: quietEnd.toISOString(),
    });

    const res = await api(testApp.server)
      .get(`/api/organizations/current/briefs/${briefId}`)
      .expect(200);
    expect(res.body.data.commitCount).toBe(0);
    expect(res.body.data.title).toContain('no activity');
    // Nothing to summarise means nothing to spend.
    expect(llm.calls.length).toBe(before);
  }, 60_000);

  it('hides no-activity briefs when asked to', async () => {
    const all = await api(testApp.server)
      .get('/api/organizations/current/briefs')
      .expect(200);
    expect(all.body.data.items.length).toBeGreaterThanOrEqual(2);

    const filtered = await api(testApp.server)
      .get('/api/organizations/current/briefs')
      .query({ excludeNoActivity: 'true' })
      .expect(200);
    expect(
      (filtered.body.data.items as Array<{ commitCount: number }>).every(
        (b) => b.commitCount > 0,
      ),
    ).toBe(true);
  });

  it('filters by scope type and by scope id', async () => {
    const byType = await api(testApp.server)
      .get('/api/organizations/current/briefs')
      .query({ scopeType: 'project' })
      .expect(200);
    expect(byType.body.data.items.length).toBeGreaterThan(0);

    const byOtherScope = await api(testApp.server)
      .get('/api/organizations/current/briefs')
      .query({
        scopeType: 'repository',
        scopeRepositoryId: repositoryId,
      })
      .expect(200);
    expect(byOtherScope.body.data.items).toEqual([]);
  });

  it('treats the date-range filter as half-open', async () => {
    const brief = await api(testApp.server)
      .get(`/api/organizations/current/briefs/${firstBriefId}`)
      .expect(200);
    const periodStart = brief.body.data.periodStart as string;

    // `from` equal to the period start includes it; `to` equal to it does not.
    // Filters compare stored exclusive `period_end` (`period_end > from` /
    // `period_end <= to`), so the same instant against start still holds.
    const included = await api(testApp.server)
      .get('/api/organizations/current/briefs')
      .query({ from: periodStart })
      .expect(200);
    expect(
      (included.body.data.items as Array<{ id: string }>).some(
        (b) => b.id === firstBriefId,
      ),
    ).toBe(true);

    const excluded = await api(testApp.server)
      .get('/api/organizations/current/briefs')
      .query({ to: periodStart })
      .expect(200);
    expect(
      (excluded.body.data.items as Array<{ id: string }>).some(
        (b) => b.id === firstBriefId,
      ),
    ).toBe(false);
  });

  it('pages the brief list', async () => {
    const page = await api(testApp.server)
      .get('/api/organizations/current/briefs')
      .query({ limit: 1 })
      .expect(200);
    expect(page.body.data.items).toHaveLength(1);
    expect(page.body.data.nextCursor).toBeTruthy();
  });

  it('rejects a limit outside the allowed range', async () => {
    await api(testApp.server)
      .get('/api/organizations/current/briefs')
      .query({ limit: 0 })
      .expect(400);
    await api(testApp.server)
      .get('/api/organizations/current/briefs')
      .query({ limit: 101 })
      .expect(400);
  });

  it('404s an unknown brief', async () => {
    const res = await api(testApp.server)
      .get(
        '/api/organizations/current/briefs/00000000-0000-4000-8000-000000000000',
      )
      .expect(404);
    expect(res.body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('deletes a brief and stops listing it', async () => {
    await api(testApp.server)
      .delete(`/api/organizations/current/briefs/${firstBriefId}`)
      .expect(204);
    await api(testApp.server)
      .get(`/api/organizations/current/briefs/${firstBriefId}`)
      .expect(404);
  });

  it('drains the jobs table', async () => {
    // A 60s dispatcher tick can enqueue `briefs.dispatchDue` after boot; wait
    // it out so "drained" means empty rather than racing that row.
    await waitForJobs(db);
    expect(await db.selectFrom('jobs').selectAll().execute()).toEqual([]);
  });
});
