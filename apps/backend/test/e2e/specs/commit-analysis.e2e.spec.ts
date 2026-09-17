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

const world = defineWorld({
  repositories: [
    {
      githubId: 900123,
      name: 'api',
      fullName: 'octo-e2e/api',
      branch: 'main',
      private: false,
      commits: [
        { sha: 'sha-feat', message: 'feat: a', at: daysAgo(2), parents: 1 },
        // Two parents: a merge commit, which the analyzer records as
        // `skipped_merge` instead of spending an LLM call on it.
        {
          sha: 'sha-merge',
          message: 'Merge pull request #1',
          at: daysAgo(1),
          parents: 2,
        },
      ],
    },
  ],
});

describe('analysing the commits on a tracked branch', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let llm: LlmFake;
  let repositoryId: string;

  beforeAll(async () => {
    // Set before the app is built: the OpenAI config reads it through
    // ConfigService, and `SecretsService` reads env in its constructor.
    process.env.OPENAI_API_KEY = 'sk-e2e';
    await installGithub(world);
    llm = await installLlm();
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);
    const ids = await seedWorld(testApp.server, db, world);
    repositoryId = ids['octo-e2e/api'];
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('records an analysis for the real commit and skips the merge', async () => {
    const rows = await db
      .selectFrom('github.commits as c')
      .innerJoin('github.commitAnalyses as a', 'a.commitId', 'c.id')
      .select(['c.sha', 'a.status', 'a.commitType', 'a.promptTokens'])
      .orderBy('c.sha')
      .execute();

    expect(rows.map((r) => [r.sha, r.status])).toEqual([
      ['sha-feat', 'analyzed'],
      ['sha-merge', 'skipped_merge'],
    ]);
    expect(rows[0].commitType).toBe('chore');
    expect(rows[0].promptTokens).toBe(10);
  });

  it('sent the commit diff to the provider, once', async () => {
    const analysisCalls = llm.calls.filter(
      (c) => c.schemaName !== 'brief_output',
    );
    expect(analysisCalls).toHaveLength(1);
    expect(JSON.stringify(analysisCalls[0].messages)).toContain('src/index.ts');
  });

  it('does not re-spend the provider on an already-analysed commit', async () => {
    const before = llm.calls.length;
    await api(testApp.server)
      .post(
        `/api/integrations/github/repositories/${repositoryId}/commits/analyze`,
      )
      .send({ days: 30 })
      .expect(202);
    await waitForJobs(db);
    expect(llm.calls.length).toBe(before);
  }, 60_000);

  it('re-analyses when the caller forces it', async () => {
    const before = llm.calls.length;
    llm.analysis({
      commit_type: 'feature',
      summary: 're-analysed',
      changes: ['second pass'],
    });

    await api(testApp.server)
      .post(
        `/api/integrations/github/repositories/${repositoryId}/commits/analyze`,
      )
      .send({ days: 30, force: true })
      .expect(202);
    await waitForJobs(db);

    expect(llm.calls.length).toBeGreaterThan(before);
    const row = await db
      .selectFrom('github.commits as c')
      .innerJoin('github.commitAnalyses as a', 'a.commitId', 'c.id')
      .select(['a.commitType', 'a.summary'])
      .where('c.sha', '=', 'sha-feat')
      .executeTakeFirstOrThrow();
    expect(row.commitType).toBe('feature');
    expect(row.summary).toBe('re-analysed');
  }, 60_000);

  it('404s a backfill for a repository outside this workspace', async () => {
    const res = await api(testApp.server)
      .post(
        '/api/integrations/github/repositories/00000000-0000-4000-8000-000000000000/commits/backfill',
      )
      .send({ days: 7 })
      .expect(404);
    expect(res.body.code).toBe('GITHUB_REPOSITORY_NOT_FOUND');
  });

  it('backfills an explicit window through the same path', async () => {
    const res = await api(testApp.server)
      .post(
        `/api/integrations/github/repositories/${repositoryId}/commits/backfill`,
      )
      .send({ days: 7 })
      .expect(202);
    expect(typeof res.body.data.jobId).toBe('string');
    await waitForJobs(db);
  }, 60_000);

  it('drains the jobs table', async () => {
    // A 60s dispatcher tick can enqueue `briefs.dispatchDue` after boot; wait
    // it out so "drained" means empty rather than racing that row.
    await waitForJobs(db);
    expect(await db.selectFrom('jobs').selectAll().execute()).toEqual([]);
  });
});
