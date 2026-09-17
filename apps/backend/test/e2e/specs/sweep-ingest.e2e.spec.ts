import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { JOB, profileFor } from '../../../src/jobs/job-profiles';
import { JobQueueService } from '../../../src/jobs/job-queue.service';
import { installGithub, type GithubFake } from '../fakes/github';
import { daysAgo, defineWorld, seedWorld } from '../fakes/world';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

const world = defineWorld();

describe('the sweep that keeps a tracked branch current', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let github: GithubFake;
  let queue: JobQueueService;

  beforeAll(async () => {
    // Same as pipeline.e2e: SecretsService reads env at construction time.
    process.env.OPENAI_API_KEY = 'sk-e2e';

    github = await installGithub(world);
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);
    queue = testApp.app.get(JobQueueService);
    await seedWorld(testApp.server, db, world);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('ingested the seeded commits on the first read', async () => {
    const commits = await db
      .selectFrom('github.commits')
      .select('sha')
      .orderBy('sha')
      .execute();
    expect(commits.map((c) => c.sha)).toEqual(['sha-newer', 'sha-older']);
  });

  it('fetches only what is new on the next sweep', async () => {
    github.reset();
    world.repositories[0].commits.push({
      sha: 'sha-newest',
      message: 'feat: arrived after the first read',
      at: daysAgo(0),
      parents: 1,
    });

    await queue.enqueue(JOB.sweepRepositories, {}, { id: 'sweep:manual-2' });
    await waitForJobs(db);

    const commits = await db
      .selectFrom('github.commits')
      .select('sha')
      .orderBy('sha')
      .execute();
    expect(commits.map((c) => c.sha)).toEqual([
      'sha-newer',
      'sha-newest',
      'sha-older',
    ]);

    // Incremental, not a re-read: the commit list is asked for with a `since`
    // anchored on what is already stored.
    const listed = github.calls.filter(
      (c) => c.paginated && c.route === 'GET /repos/{owner}/{repo}/commits',
    );
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((c) => typeof c.params.since === 'string')).toBe(true);

    // The two commits already analysed are not sent to the LLM again — only
    // the new one gets a fresh analysis row.
    const analyses = await db
      .selectFrom('github.commitAnalyses')
      .select('id')
      .execute();
    expect(analyses).toHaveLength(3);
  }, 60_000);

  it('survives a rate-limited GitHub and finishes on the retry', async () => {
    github.reset();
    // 429 on the commit list for the first attempt only; the ingest profile is
    // 4 attempts, so the job recovers by itself and the row is deleted.
    github.failNext(
      'GET /repos/{owner}/{repo}/commits',
      429,
      'API rate limit exceeded',
    );

    await queue.enqueue(JOB.sweepRepositories, {}, { id: 'sweep:manual-3' });
    await waitForJobs(db, 120_000);

    expect(await db.selectFrom('jobs').selectAll().execute()).toEqual([]);
  }, 180_000);

  it('leaves a terminally failed job behind instead of re-arming it at once', async () => {
    // Queue semantics only: `analyzeRepo` swallows per-commit errors, so a
    // terminally failed row is seeded — not produced by a live failing run.
    const repositoryId = (
      await db
        .selectFrom('github.repositories')
        .select('id')
        .where('deletedAt', 'is', null)
        .executeTakeFirstOrThrow()
    ).id;

    const sinceISO = daysAgo(30).toISOString();
    const terminalAttempts = profileFor(JOB.analyzeRepo).maxAttempts;
    await db
      .insertInto('jobs')
      .values({
        id: 'analyze:e2e-cooldown',
        type: JOB.analyzeRepo,
        args: JSON.stringify({
          repositoryId,
          sinceISO,
          force: false,
          organizationId: null,
        }),
        state: 'failed',
        attempts: terminalAttempts,
        maxAttempts: terminalAttempts,
        runAt: new Date(),
        error: 'e2e: terminally failed analyze row',
        phase: 'analyzing',
        organizationId: null,
      })
      .execute();

    const failed = await jobRow(db, 'analyze:e2e-cooldown');
    expect(failed.state).toBe('failed');
    expect(failed.attempts).toBe(terminalAttempts);

    // An automatic caller re-enqueuing the same stable id inside the cooldown
    // must not hand the row a fresh retry budget (`8f38738`).
    await queue.enqueue(JOB.analyzeRepo, {}, { id: 'analyze:e2e-cooldown' });
    const still = await jobRow(db, 'analyze:e2e-cooldown');
    expect(still.state).toBe('failed');
    expect(still.attempts).toBe(failed.attempts);

    // A person pressing retry does get one: `force` skips the cooldown.
    await queue.enqueue(
      JOB.analyzeRepo,
      {
        repositoryId,
        sinceISO,
        force: false,
        organizationId: null,
      },
      { id: 'analyze:e2e-cooldown', force: true },
    );
    const rearmed = await jobRow(db, 'analyze:e2e-cooldown');
    expect(rearmed.state).toBe('pending');
    expect(rearmed.attempts).toBe(0);

    await waitForJobs(db, 60_000);
  }, 180_000);

  it('drops a dead run’s checkpoint when the row is re-armed', async () => {
    // `8c2d293`: a paging handler writes its resume point onto the running row
    // so a retry continues instead of restarting at page 1 — and the re-arm of
    // a terminally failed row clears `args` again, because a checkpointed
    // cursor belongs to the run that died and a fresh enqueue is a fresh
    // window. This asserts the second half; the per-page checkpoint itself is
    // asserted directly in `commit-analysis.jobs.spec.ts`, and proving it here
    // would mean seeding 501 commits (PAGE = 500) for a property the unit
    // suite already pins.
    await queue.enqueue(
      JOB.analyzeRepo,
      {
        repositoryId: 'never-read',
        sinceISO: 'x',
        cursor: { authoredAt: 'y', id: 'z' },
      },
      { id: 'analyze:e2e-checkpoint' },
    );
    await db
      .updateTable('jobs')
      .set({
        state: 'failed',
        runAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      })
      .where('id', '=', 'analyze:e2e-checkpoint')
      .execute();

    await queue.enqueue(
      JOB.analyzeRepo,
      { repositoryId: 'fresh', sinceISO: 'x' },
      { id: 'analyze:e2e-checkpoint' },
    );

    const row = await db
      .selectFrom('jobs')
      .select(['state', 'args'])
      .where('id', '=', 'analyze:e2e-checkpoint')
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('pending');
    expect((row.args as { cursor?: unknown }).cursor).toBeUndefined();
    expect((row.args as { repositoryId?: string }).repositoryId).toBe('fresh');

    await db
      .deleteFrom('jobs')
      .where('id', '=', 'analyze:e2e-checkpoint')
      .execute();
  }, 60_000);
});

async function jobRow(
  db: Kysely<Database>,
  id: string,
): Promise<{ state: string; attempts: number }> {
  return db
    .selectFrom('jobs')
    .select(['state', 'attempts'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}
