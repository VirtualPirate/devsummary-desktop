import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { installAgentCli, type AgentCliFake } from '../fakes/agent-cli';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';

describe('the settings screen on a fresh install', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let cli: AgentCliFake;

  beforeAll(async () => {
    // No credentials: `.env.test` sets none on purpose, and this file is the
    // one that proves the first-run state is clean rather than a wall of
    // failures (RELEASE-CHECKLIST).
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.SLACK_BOT_TOKEN;
    cli = await installAgentCli();
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);
  });

  afterAll(async () => {
    await cli.teardown();
    await testApp.close();
  });

  it('reports every credential absent, with the default provider selected', async () => {
    const res = await api(testApp.server)
      .get('/api/local-settings')
      .expect(200);
    expect(res.body.data).toMatchObject({
      github: false,
      openai: false,
      gemini: false,
      slack: false,
      llmProvider: 'openai',
      desktopNotifications: true,
      commitAnalysisModel: 'gpt-4o-mini',
      briefModel: 'gpt-4o-mini',
    });
    expect(res.body.data.dataDir).toMatch(/^\//);
    // The `userData` root, not the PGlite `data/` child inside it. The screen
    // printing this also names `logs/` and `secrets.bin`, which are its
    // siblings, and its Open button reveals the parent — so naming `data/`
    // sent anyone following that copy one directory too deep.
    expect(res.body.data.dataDir.endsWith('/data')).toBe(false);
  });

  it('enqueues nothing on a fresh install', async () => {
    // The boot sweep runs on module init and finds no tracked branch, so it
    // stops at one indexed query. A first run that fans out failing jobs is
    // exactly the regression this guards.
    const jobs = await db
      .selectFrom('jobs')
      .select(['type', 'state'])
      .execute();
    expect(jobs.filter((j) => j.state === 'failed')).toEqual([]);
  });

  it('stores an OpenAI key and reports it without echoing it back', async () => {
    const res = await api(testApp.server)
      .put('/api/local-settings/credentials')
      .send({ openaiApiKey: 'sk-e2e-local' })
      .expect(200);
    expect(res.body.data.openai).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('sk-e2e-local');
  });

  it('switches provider and reports that provider’s effective models', async () => {
    const res = await api(testApp.server)
      .put('/api/local-settings/credentials')
      .send({ llmProvider: 'gemini' })
      .expect(200);
    expect(res.body.data.llmProvider).toBe('gemini');
    expect(res.body.data.commitAnalysisModel).toBe('gemini-3.1-flash-lite');
  });

  it('honours a model override for the selected provider', async () => {
    const res = await api(testApp.server)
      .put('/api/local-settings/credentials')
      .send({ commitAnalysisModel: 'gemini-3.1-pro' })
      .expect(200);
    expect(res.body.data.commitAnalysisModel).toBe('gemini-3.1-pro');
  });

  it('rejects a provider that does not exist', async () => {
    await api(testApp.server)
      .put('/api/local-settings/credentials')
      .send({ llmProvider: 'gemeni' })
      .expect(400);
  });

  it('clears a credential with an empty string', async () => {
    const res = await api(testApp.server)
      .put('/api/local-settings/credentials')
      .send({ openaiApiKey: '' })
      .expect(200);
    expect(res.body.data.openai).toBe(false);
  });

  it('reports every agent CLI as not installed when none is on PATH', async () => {
    const res = await api(testApp.server)
      .get('/api/local-settings/agents?refresh=1')
      .expect(200);
    const statuses = res.body.data as Array<{ id: string; installed: boolean }>;
    expect(statuses.map((s) => s.id)).toEqual([
      'claude-code',
      'opencode',
      'cursor',
      'codex',
    ]);
    expect(statuses.every((s) => !s.installed)).toBe(true);
  });

  it('reports an installed CLI with its version and login state', async () => {
    await cli.install('claude');
    // `?refresh=1` because the detector caches a status for 60 s; without it
    // this reads the "not installed" answer the previous spec just cached.
    const res = await api(testApp.server)
      .get('/api/local-settings/agents?refresh=1')
      .expect(200);
    const claude = (res.body.data as Array<Record<string, unknown>>).find(
      (s) => s.id === 'claude-code',
    );
    expect(claude).toMatchObject({
      installed: true,
      version: '2.0.31 (Claude Code)',
      authenticated: true,
    });
    expect(String(claude?.path)).toContain('/claude');
  });

  it('answers the test button with a usable error for a missing binary', async () => {
    const res = await api(testApp.server)
      .post('/api/local-settings/agents/codex/test')
      .expect(400);
    expect(res.body.message).toContain('Codex');
    expect(res.body.message).toContain('not installed');
  });

  it('answers the test button with ok for an installed CLI', async () => {
    const res = await api(testApp.server)
      .post('/api/local-settings/agents/claude-code/test')
      .expect(201);
    expect(res.body.data.ok).toBe(true);
    expect(typeof res.body.data.detail).toBe('string');
  });

  it('rejects an agent id that is not one of the four', async () => {
    await api(testApp.server)
      .post('/api/local-settings/agents/not-an-agent/test')
      .expect(400);
  });
});
