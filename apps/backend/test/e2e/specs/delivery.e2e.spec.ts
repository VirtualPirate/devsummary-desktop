import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { installFakes, seedWorld, type Fakes } from '../fakes';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

describe('delivering a brief to Slack and to the desktop', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let fakes: Fakes;
  let projectId: string;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'sk-e2e';
    fakes = await installFakes();
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);

    const ids = await seedWorld(testApp.server, db, fakes.world);
    const project = await api(testApp.server)
      .post('/api/organizations/current/projects')
      .send({ name: 'Platform', repositoryIds: [ids['octo-e2e/api']] })
      .expect(201);
    projectId = project.body.data.id as string;

    await api(testApp.server)
      .post('/api/integrations/slack/installations/token')
      .send({ token: 'xoxb-e2e' })
      .expect(201);
  });

  afterAll(async () => {
    await fakes.teardown();
    await testApp.close();
  });

  async function generate(
    delivery?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await api(testApp.server)
      .post('/api/organizations/current/briefs/generate')
      .send({ scope: { type: 'project', projectId }, ...(delivery ? { delivery } : {}) })
      .expect(202);
    const briefId = res.body.data.briefId as string;
    await waitForJobs(db, 60_000);
    return db
      .selectFrom('briefs.briefs')
      .selectAll()
      .where('id', '=', briefId)
      .executeTakeFirstOrThrow() as unknown as Record<string, unknown>;
  }

  it('lists the Slack channels the bot can post to', async () => {
    const res = await api(testApp.server)
      .get('/api/integrations/slack/channels')
      .expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('delivers to both channels and records both', async () => {
    const brief = await generate({ slackChannelId: 'C-E2E' });

    expect(brief.status).toBe('delivered');
    expect(brief.deliveredAt).not.toBeNull();
    expect(new Set(brief.deliveredChannels as string[])).toEqual(
      new Set(['slack', 'desktop']),
    );
    expect(fakes.slack.posts.at(-1)?.channel).toBe('C-E2E');

    // The desktop channel actually reached a shell — the path that is dead in
    // every spec file that does not install this fake.
    const notification = fakes.shell.messages.at(-1);
    expect(notification).toMatchObject({ type: 'notification' });
    expect(String(notification?.title)).not.toBe('');
  }, 60_000);

  it('still counts as delivered when only one channel succeeds', async () => {
    fakes.slack.failNextPost('channel_not_found');
    const brief = await generate({ slackChannelId: 'C-GONE' });

    // `status` is a whole-brief verdict; the channel list is what says where it
    // actually landed.
    expect(brief.status).toBe('delivered');
    expect(brief.deliveredChannels).toEqual(['desktop']);
    expect(String(brief.failureReason)).toContain('[slack]');
  }, 60_000);

  it('records both reasons and does not claim delivery when every channel fails', async () => {
    fakes.slack.failNextPost('channel_not_found');
    fakes.shell.detach();

    const brief = await generate({ slackChannelId: 'C-GONE' });

    expect(brief.status).toBe('generated');
    expect(brief.deliveredAt).toBeNull();
    expect(String(brief.failureReason)).toContain('[slack]');
    expect(String(brief.failureReason)).toContain('[desktop]');

    // `detach()` deletes the port and nothing else puts it back. Later tests
    // that care about desktop (the notifications toggle) would otherwise
    // generate against a missing port and prove nothing.
    fakes.shell.attach();
  }, 60_000);

  it('re-sends one channel synchronously, answering with Slack’s own refusal', async () => {
    const brief = await generate({ slackChannelId: 'C-GONE' });
    fakes.slack.failNextPost('not_in_channel');

    const res = await api(testApp.server)
      .post(`/api/organizations/current/briefs/${brief.id as string}/deliver`)
      .send({ channel: 'slack' });

    // Synchronous on purpose: a person is watching a button, so the reason
    // comes back in the response rather than landing on the row minutes later.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toContain('not_in_channel');
  }, 60_000);

  it('re-sends successfully once the bot is back in the channel', async () => {
    const brief = await generate({ slackChannelId: 'C-E2E' });
    const res = await api(testApp.server)
      .post(`/api/organizations/current/briefs/${brief.id as string}/deliver`)
      .send({ channel: 'slack' })
      .expect(201);
    expect(res.body.data.deliveredChannels).toContain('slack');
  }, 60_000);

  it('recovers delivery for a brief that crashed after generation', async () => {
    // The `1b00b7f` hole: a brief left `generated` with its job row requeued
    // must resume at the send rather than be dropped, and must not re-spend the
    // LLM call on content already written.
    const brief = await generate({ slackChannelId: 'C-E2E' });
    const briefId = brief.id as string;

    await db
      .updateTable('briefs.briefs')
      .set({ status: 'generated', deliveredAt: null, deliveredChannels: [] })
      .where('id', '=', briefId)
      .execute();

    const before = fakes.llm.calls.length;
    fakes.slack.reset();

    const queue = testApp.app.get(
      (await import('../../../src/jobs/job-queue.service')).JobQueueService,
    );
    const { JOB } = await import('../../../src/jobs/job-profiles');
    await queue.enqueue(JOB.generateBrief, { briefId }, { id: `brief:${briefId}` });
    await waitForJobs(db, 60_000);

    const after = await db
      .selectFrom('briefs.briefs')
      .select(['status', 'title', 'deliveredChannels'])
      .where('id', '=', briefId)
      .executeTakeFirstOrThrow();

    expect(after.status).toBe('delivered');
    expect(after.deliveredChannels).toContain('slack');
    // Resumed at the send: the content it already had was not regenerated.
    expect(fakes.llm.calls.length).toBe(before);
  }, 60_000);

  it('does not deliver when the user turned desktop notifications off', async () => {
    fakes.shell.attach();
    fakes.shell.messages.length = 0;

    await generate({ slackChannelId: 'C-E2E' });
    expect(fakes.shell.messages.at(-1)).toMatchObject({ type: 'notification' });

    await api(testApp.server)
      .put('/api/local-settings/credentials')
      .send({ desktopNotifications: false })
      .expect(200);

    fakes.shell.messages.length = 0;
    await generate({ slackChannelId: 'C-E2E' });
    expect(fakes.shell.messages).toEqual([]);

    await api(testApp.server)
      .put('/api/local-settings/credentials')
      .send({ desktopNotifications: true })
      .expect(200);
  }, 60_000);

  it('drains the jobs table', async () => {
    // A 60s dispatcher tick can enqueue `briefs.dispatchDue` after boot; wait
    // it out so "drained" means empty rather than racing that row.
    await waitForJobs(db);
    expect(await db.selectFrom('jobs').selectAll().execute()).toEqual([]);
  });
});
