import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { JOB } from '../../../src/jobs/job-profiles';
import { JobQueueService } from '../../../src/jobs/job-queue.service';
import { installGithub, type GithubFake } from '../fakes/github';
import { installLlm } from '../fakes/llm';
import { defineWorld, seedWorld } from '../fakes/world';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

const world = defineWorld();
const ZONE = 'America/New_York';

/** The wall-clock time `instant` falls on in `zone`, as `HH:MM`. */
function wallClock(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

describe('brief schedules', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let github: GithubFake;
  let queue: JobQueueService;
  let projectId: string;
  let scheduleId: string;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'sk-e2e';
    github = await installGithub(world);
    await installLlm();
    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);
    queue = testApp.app.get(JobQueueService);

    const ids = await seedWorld(testApp.server, db, world);
    const project = await api(testApp.server)
      .post('/api/organizations/current/projects')
      .send({ name: 'Platform', repositoryIds: [ids['octo-e2e/api']] })
      .expect(201);
    projectId = project.body.data.id as string;
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('refuses a create while commits are still being read', async () => {
    // Hold one ingest open rather than racing it: while this promise is
    // pending the job is `running`, which is exactly what `ingesting` means.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    github.on('GET /repos/{owner}/{repo}/commits', async () => {
      await held;
      return [];
    });

    const repositoryId = (
      await db
        .selectFrom('github.repositories')
        .select('id')
        .where('deletedAt', 'is', null)
        .executeTakeFirstOrThrow()
    ).id;
    await api(testApp.server)
      .post(
        `/api/integrations/github/repositories/${repositoryId}/commits/backfill`,
      )
      .send({ days: 7 })
      .expect(202);

    // Poll the ingest-status flag the service itself gates on, so this waits
    // for the job to be claimed rather than sleeping for a plausible interval.
    await waitFor(async () => {
      const res = await api(testApp.server)
        .get('/api/integrations/github/repositories/ingest-status')
        .expect(200);
      return res.body.data.ingesting === true;
    });

    const refused = await api(testApp.server)
      .post('/api/organizations/current/brief-schedules')
      .send({
        name: 'Too early',
        cadence: { type: 'daily', time: '09:00' },
        timezone: 'UTC',
        scope: { type: 'project', projectId },
        backfillMonths: 0,
      })
      .expect(409);
    expect(refused.body.code).toBe('BRIEF_SCHEDULE_COMMITS_PROCESSING');

    release();
    github.on('GET /repos/{owner}/{repo}/commits', null);
    await waitForJobs(db, 60_000);
  }, 120_000);

  it('creates a daily schedule once ingest is idle', async () => {
    const res = await api(testApp.server)
      .post('/api/organizations/current/brief-schedules')
      .send({
        name: 'Daily standup',
        cadence: { type: 'daily', time: '09:00' },
        timezone: ZONE,
        scope: { type: 'project', projectId },
        // 0: this spec is about the schedule, not about the backfill fan-out.
        backfillMonths: 0,
      })
      .expect(201);

    scheduleId = res.body.data.id as string;
    expect(res.body.data.paused).toBe(false);
    // Postgres `time` stores HH:MM:SS; the request accepted `09:00`.
    expect(res.body.data.cadence).toEqual({
      type: 'daily',
      time: '09:00:00',
    });
  });

  it('computes nextRunAt as 09:00 wall-clock in the schedule’s own zone', async () => {
    const res = await api(testApp.server)
      .get(`/api/organizations/current/brief-schedules/${scheduleId}`)
      .expect(200);

    const nextRunAt = new Date(res.body.data.nextRunAt as string);
    expect(nextRunAt.getTime()).toBeGreaterThan(Date.now());
    // The DST-proof assertion: a fixed UTC offset is right for half the year
    // and an hour wrong for the other half. Rendering in the zone is right all
    // year, and is what `CadenceService` resolves through `Intl`.
    expect(wallClock(nextRunAt, ZONE)).toBe('09:00');
  });

  it('keeps the wall-clock time when the cadence moves to weekly', async () => {
    const res = await api(testApp.server)
      .patch(`/api/organizations/current/brief-schedules/${scheduleId}`)
      .send({ cadence: { type: 'weekly', time: '17:30', dayOfWeek: 1 } })
      .expect(200);

    const nextRunAt = new Date(res.body.data.nextRunAt as string);
    expect(wallClock(nextRunAt, ZONE)).toBe('17:30');
    // Monday, in the schedule's zone — not in the process's.
    const weekday = new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONE,
      weekday: 'long',
    }).format(nextRunAt);
    expect(weekday).toBe('Monday');
  });

  it('rejects a malformed cadence time and an unknown zone', async () => {
    await api(testApp.server)
      .post('/api/organizations/current/brief-schedules')
      .send({
        name: 'Bad time',
        cadence: { type: 'daily', time: '25:00' },
        timezone: 'UTC',
        scope: { type: 'project', projectId },
      })
      .expect(400);

    const badZone = await api(testApp.server)
      .post('/api/organizations/current/brief-schedules')
      .send({
        name: 'Bad zone',
        cadence: { type: 'daily', time: '09:00' },
        timezone: 'Mars/Olympus_Mons',
        scope: { type: 'project', projectId },
      });
    expect(badZone.status).toBeGreaterThanOrEqual(400);
    expect(badZone.status).toBeLessThan(500);
  });

  it('404s a scope that is not in this workspace', async () => {
    await api(testApp.server)
      .post('/api/organizations/current/brief-schedules')
      .send({
        name: 'Foreign scope',
        cadence: { type: 'daily', time: '09:00' },
        timezone: 'UTC',
        scope: {
          type: 'project',
          projectId: '00000000-0000-4000-8000-000000000000',
        },
      })
      .expect(404);
  });

  it('pauses and resumes', async () => {
    const paused = await api(testApp.server)
      .post(`/api/organizations/current/brief-schedules/${scheduleId}/pause`)
      .expect(201);
    expect(paused.body.data.paused).toBe(true);

    const resumed = await api(testApp.server)
      .post(`/api/organizations/current/brief-schedules/${scheduleId}/resume`)
      .expect(201);
    expect(resumed.body.data.paused).toBe(false);
  });

  it('does not dispatch a paused schedule that is due', async () => {
    await db
      .updateTable('briefs.briefSchedules')
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where('id', '=', scheduleId)
      .execute();
    await api(testApp.server)
      .post(`/api/organizations/current/brief-schedules/${scheduleId}/pause`)
      .expect(201);

    await queue.enqueue(JOB.dispatchDueBriefs, {}, { id: 'dispatch:e2e-1' });
    await waitForJobs(db, 60_000);

    const briefs = await db.selectFrom('briefs.briefs').selectAll().execute();
    expect(briefs).toEqual([]);
  }, 60_000);

  it('dispatches a due schedule and generates its brief', async () => {
    await api(testApp.server)
      .post(`/api/organizations/current/brief-schedules/${scheduleId}/resume`)
      .expect(201);
    await db
      .updateTable('briefs.briefSchedules')
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where('id', '=', scheduleId)
      .execute();

    await queue.enqueue(JOB.dispatchDueBriefs, {}, { id: 'dispatch:e2e-2' });
    await waitForJobs(db, 60_000);

    const briefs = await db
      .selectFrom('briefs.briefs')
      .select(['id', 'status', 'briefScheduleId'])
      .execute();
    expect(briefs).toHaveLength(1);
    expect(briefs[0].briefScheduleId).toBe(scheduleId);

    // Claiming advances the schedule rather than leaving it due forever.
    const after = await api(testApp.server)
      .get(`/api/organizations/current/brief-schedules/${scheduleId}`)
      .expect(200);
    expect(new Date(after.body.data.nextRunAt as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  }, 60_000);

  it('deletes the schedule and stops listing it', async () => {
    await api(testApp.server)
      .delete(`/api/organizations/current/brief-schedules/${scheduleId}`)
      .expect(204);
    const list = await api(testApp.server)
      .get('/api/organizations/current/brief-schedules')
      .expect(200);
    expect(list.body.data).toEqual([]);
  });

  it('drains the jobs table', async () => {
    // A 60s dispatcher tick can enqueue `briefs.dispatchDue` after boot; wait
    // it out so "drained" means empty rather than racing that row.
    await waitForJobs(db);
    expect(await db.selectFrom('jobs').selectAll().execute()).toEqual([]);
  });
});

/** Poll a predicate until it holds. Never a `sleep` for a fixed guess. */
async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('condition never held');
    await new Promise((r) => setTimeout(r, 50));
  }
}
