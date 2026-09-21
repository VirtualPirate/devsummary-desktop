import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { installAgentCli, type AgentCliFake } from '../fakes/agent-cli';
import { installGithub } from '../fakes/github';
import { installLlm, type LlmFake } from '../fakes/llm';
import { defineWorld, seedWorld } from '../fakes/world';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

const world = defineWorld();

describe('generating a brief on each provider', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let llm: LlmFake;
  let cli: AgentCliFake;
  let projectId: string;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'sk-e2e';
    await installGithub(world);
    llm = await installLlm();
    cli = await installAgentCli();
    await cli.install('claude', 'opencode', 'agent', 'codex');
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);

    const ids = await seedWorld(testApp.server, db, world);
    const project = await api(testApp.server)
      .post('/api/organizations/current/projects')
      .send({ name: 'Platform', repositoryIds: [ids['octo-e2e/api']] })
      .expect(201);
    projectId = project.body.data.id as string;
  });

  afterAll(async () => {
    await cli.teardown();
    await testApp.close();
  });

  /** Generate one brief and return its row. */
  async function generate(): Promise<{
    id: string;
    status: string;
    title: string | null;
    model: string | null;
    failureReason: string | null;
  }> {
    const res = await api(testApp.server)
      .post('/api/organizations/current/briefs/generate')
      .send({ scope: { type: 'project', projectId } })
      .expect(202);
    const briefId = res.body.data.briefId as string;
    await waitForJobs(db, 60_000);
    return db
      .selectFrom('briefs.briefs')
      .select(['id', 'status', 'title', 'model', 'failureReason'])
      .where('id', '=', briefId)
      .executeTakeFirstOrThrow();
  }

  /**
   * Failure paths go through `briefs.generate` (`standard`: 4 attempts, 30s
   * initial backoff). `generateContent` writes `failed` + `failureReason` on
   * the first attempt, then throws so the job retries. `waitForJobs` would sit
   * through that backoff (and throw once the row is terminally `failed`), so
   * poll the brief row the way Task 3's `waitForJobState` polls a job — never
   * a `sleep`. Delete the leftover `brief:<id>` row afterwards: otherwise a
   * later `waitForJobs` (or a retry after we reinstall a CLI) would see it.
   */
  async function generateUntilFailed(): Promise<{
    id: string;
    status: string;
    title: string | null;
    model: string | null;
    failureReason: string | null;
  }> {
    const res = await api(testApp.server)
      .post('/api/organizations/current/briefs/generate')
      .send({ scope: { type: 'project', projectId } })
      .expect(202);
    const briefId = res.body.data.briefId as string;
    const deadline = Date.now() + 90_000;
    for (;;) {
      const brief = await db
        .selectFrom('briefs.briefs')
        .select(['id', 'status', 'title', 'model', 'failureReason'])
        .where('id', '=', briefId)
        .executeTakeFirst();
      if (brief?.status === 'failed') {
        await db
          .deleteFrom('jobs')
          .where('id', '=', `brief:${briefId}`)
          .execute();
        return brief;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `brief ${briefId} never reached failed (last: ${brief?.status ?? 'missing'})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function selectProvider(
    llmProvider: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await api(testApp.server)
      .put('/api/local-settings/credentials')
      .send({ llmProvider, ...extra })
      .expect(200);
  }

  it('generates through OpenAI', async () => {
    llm.brief({
      title: 'OpenAI brief',
      summary: 'From the SDK.',
      highlights: [],
    });
    const brief = await generate();
    expect(brief.title).toBe('OpenAI brief');
    expect(brief.model).toBe('gpt-4o-mini');
  }, 60_000);

  it('switches to Gemini at runtime, with no restart', async () => {
    const before = llm.calls.length;
    await selectProvider('gemini', { geminiApiKey: 'gm-e2e' });

    llm.brief({
      title: 'Gemini brief',
      summary: 'Same SDK, other endpoint.',
      highlights: [],
    });
    const brief = await generate();

    expect(brief.title).toBe('Gemini brief');
    expect(brief.model).toBe('gemini-3.1-flash-lite');
    // Gemini speaks `/chat/completions`, OpenAI speaks `/responses`. The
    // difference is the whole reason `GeminiLlmClient` exists.
    expect(llm.calls.slice(before).some((c) => c.kind === 'chat')).toBe(true);
  }, 60_000);

  it.each([
    ['claude-code', 'claude'],
    ['opencode', 'opencode'],
    ['cursor', 'agent'],
    ['codex', 'codex'],
  ] as const)(
    'generates through the %s CLI',
    async (provider, binary) => {
      await selectProvider(provider);
      cli.answer(binary, {
        title: `${provider} brief`,
        summary: 'From the local agent.',
        highlights: [],
      });
      const before = llm.calls.length;

      const brief = await generate();

      expect(brief.status).toBe('generated');
      expect(brief.title).toBe(`${provider} brief`);
      // No SDK call: the whole point of an agent provider is that it spends the
      // binary's own login, not a key.
      expect(llm.calls.length).toBe(before);
      expect(cli.calls.at(-1)?.file).toContain(`/${binary}`);
    },
    60_000,
  );

  it('never leaks the credential bundle into the CLI child environment', async () => {
    // The security boundary: these children run a model whose prompt is an
    // untrusted commit diff. `run-cli.ts` is real under this alias, so this
    // asserts the actual stripping rather than a test double of it.
    const spawned = cli.calls.at(-1);
    expect(spawned).toBeDefined();
    for (const key of [
      'OPENAI_API_KEY',
      'GEMINI_API_KEY',
      'GITHUB_TOKEN',
      'DB_ENCRYPTION_KEY',
    ]) {
      expect(spawned?.env[key]).toBeUndefined();
    }
    // A deny-list, not an allow-list: the child still has to find its own home.
    expect(spawned?.env.PATH).toBeDefined();
  });

  it('writes the prompt to stdin rather than argv', async () => {
    // Prompts reach 60k characters; argv has length limits and quoting rules.
    const spawned = cli.calls.at(-1);
    expect(spawned?.stdin).toBeTruthy();
    expect(spawned?.args.join(' ').length).toBeLessThan(10_000);
  });

  it('fails the brief with the CLI’s own reason when the binary is gone', async () => {
    await selectProvider('claude-code');
    await cli.uninstall('claude');
    // Bypass the detector's 60 s cache the same way the UI does.
    await api(testApp.server)
      .get('/api/local-settings/agents?refresh=1')
      .expect(200);

    const brief = await generateUntilFailed();
    expect(brief.status).not.toBe('delivered');
    expect(brief.failureReason ?? '').not.toBe('');
    await cli.install('claude');
  }, 120_000);

  it('fails the brief when the CLI exits non-zero', async () => {
    await api(testApp.server)
      .get('/api/local-settings/agents?refresh=1')
      .expect(200);
    cli.fail('claude', {
      code: 1,
      stdout: '',
      stderr: 'Authentication required',
    });

    const brief = await generateUntilFailed();
    expect(brief.status).not.toBe('delivered');
    expect(brief.failureReason ?? '').toContain('Authentication required');
  }, 120_000);

  it('fails the brief when the CLI prints something that is not its envelope', async () => {
    cli.fail('claude', { code: 0, stdout: 'not json at all', stderr: '' });
    const brief = await generateUntilFailed();
    expect(brief.status).not.toBe('delivered');
    expect(brief.failureReason ?? '').not.toBe('');
  }, 120_000);

  it('fails clearly when the selected provider has no key at all', async () => {
    cli.answer('claude', { title: 'x', summary: 'y', highlights: [] });
    await selectProvider('openai', { openaiApiKey: '' });
    const brief = await generateUntilFailed();
    expect(brief.status).not.toBe('delivered');
    expect(brief.failureReason ?? '').not.toBe('');
  }, 60_000);
});
