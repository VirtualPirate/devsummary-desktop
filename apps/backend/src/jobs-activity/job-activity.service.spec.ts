import { Logger } from '@nestjs/common';
import type { AppDatabase } from '../databases/kysely';
import { createJobsDb } from '../jobs/__tests__/jobs-test-db';
import { JobActivityService } from './job-activity.service';

jest.setTimeout(30_000);

const ORG_ID = '3f1a9c62-2c1f-4f2e-9a52-4b1d0d5f8e11';
const OTHER_ORG_ID = '11111111-1111-4111-8111-111111111111';

let db: AppDatabase;
let svc: JobActivityService;

beforeAll(async () => {
  db = await createJobsDb();
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await db.deleteFrom('jobs').execute();
  svc = new JobActivityService(db);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

async function job(over: {
  id: string;
  phase?: string;
  state?: 'pending' | 'running' | 'failed';
  organizationId?: string;
}): Promise<void> {
  await db
    .insertInto('jobs')
    .values({
      id: over.id,
      type: 'github.scanRepository',
      args: JSON.stringify({}),
      phase: over.phase ?? null,
      state: over.state ?? 'running',
      organizationId: over.organizationId ?? ORG_ID,
    })
    .execute();
}

describe('JobActivityService', () => {
  it('aggregates per-phase running counts', async () => {
    await job({ id: 'a', phase: 'fetching' });
    await job({ id: 'b', phase: 'fetching' });
    await job({ id: 'c', phase: 'analyzing' });

    expect(await svc.forOrganization(ORG_ID)).toEqual({
      fetching: 2,
      analyzing: 1,
      generating: 0,
      active: true,
    });
  });

  it('active is false when all zero', async () => {
    expect(await svc.forOrganization(ORG_ID)).toEqual({
      fetching: 0,
      analyzing: 0,
      generating: 0,
      active: false,
    });
  });

  it('counts only running jobs of this organization', async () => {
    // Queued-but-not-started work is not activity: the toast says what is
    // happening now, and a pending row may never be claimed at all.
    await job({ id: 'pending', phase: 'fetching', state: 'pending' });
    await job({ id: 'failed', phase: 'analyzing', state: 'failed' });
    await job({
      id: 'other-org',
      phase: 'fetching',
      organizationId: OTHER_ORG_ID,
    });
    // System-scoped work (the sweep) carries neither org nor phase.
    await db
      .insertInto('jobs')
      .values({
        id: 'sweep',
        type: 'github.sweep',
        args: JSON.stringify({}),
        state: 'running',
      })
      .execute();
    await job({ id: 'mine', phase: 'generating' });

    expect(await svc.forOrganization(ORG_ID)).toEqual({
      fetching: 0,
      analyzing: 0,
      generating: 1,
      active: true,
    });
  });

  it('degrades to empty on error', async () => {
    const broken = {
      selectFrom: () => {
        throw new Error('down');
      },
    } as unknown as AppDatabase;

    expect(
      await new JobActivityService(broken).forOrganization(ORG_ID),
    ).toEqual({ active: false, fetching: 0, analyzing: 0, generating: 0 });
  });

  it('fails closed on a non-uuid org id without querying', async () => {
    const selectFrom = jest.fn();
    const spied = new JobActivityService({
      selectFrom,
    } as unknown as AppDatabase);

    expect(await spied.forOrganization('org-1')).toEqual({
      active: false,
      fetching: 0,
      analyzing: 0,
      generating: 0,
    });
    expect(selectFrom).not.toHaveBeenCalled();
  });
});
