/**
 * Ported from `temporal/workflows/__tests__/generate-brief.workflow.spec.ts`.
 *
 * The Temporal test environment is gone, so the orchestration is driven
 * directly against mocked activities and a mocked queue. These are the only
 * proof the port preserved the workflow semantics (plan R10) — the four
 * `GenerateBriefWorkflow` branches are ported one-for-one, and the two fan-out
 * workflows gained the child-id assertions `startChild` used to carry.
 */
import { JOB, JobHandlerRegistry } from '../../../jobs';
import { BriefJobs } from './brief.jobs';
import type { BriefActivities } from './brief.activities';

type Activities = jest.Mocked<
  Pick<
    BriefActivities,
    | 'markGenerating'
    | 'generateContent'
    | 'deliver'
    | 'planBackfill'
    | 'claimDue'
  >
>;

function makeJobs(overrides: Partial<Activities> = {}) {
  const activities = {
    markGenerating: jest.fn(async () => ({ proceed: true })),
    generateContent: jest.fn(async () => ({ terminal: false })),
    deliver: jest.fn(async () => undefined),
    planBackfill: jest.fn(async () => ({ briefs: [] })),
    claimDue: jest.fn(async () => ({ briefs: [] })),
    ...overrides,
  } as unknown as Activities;

  const queue = {
    enqueue: jest.fn(
      async (_t: string, _a: unknown, opts?: { id?: string }) =>
        opts?.id ?? 'job-id',
    ),
  };
  const registry = new JobHandlerRegistry();
  const jobs = new BriefJobs(
    activities as unknown as BriefActivities,
    queue as never,
    registry,
  );
  return { jobs, activities, queue, registry };
}

describe('BriefJobs — briefs.generate (was GenerateBriefWorkflow)', () => {
  it('delivers when markGenerating proceeds, generation is non-terminal, and deliver is not false', async () => {
    const { jobs, activities } = makeJobs();

    await jobs.generate({ briefId: 'b1', deliver: true });

    expect(activities.deliver).toHaveBeenCalledWith({ briefId: 'b1' });
  });

  it('does not deliver when markGenerating returns proceed:false', async () => {
    const { jobs, activities } = makeJobs({
      markGenerating: jest.fn(async () => ({ proceed: false })) as never,
    });

    await jobs.generate({ briefId: 'b2', deliver: true });

    expect(activities.generateContent).not.toHaveBeenCalled();
    expect(activities.deliver).not.toHaveBeenCalled();
  });

  it('does not deliver when generateContent returns terminal:true', async () => {
    const { jobs, activities } = makeJobs({
      generateContent: jest.fn(async () => ({ terminal: true })) as never,
    });

    await jobs.generate({ briefId: 'b3', deliver: true });

    expect(activities.deliver).not.toHaveBeenCalled();
  });

  it('does not deliver when the input requests deliver:false', async () => {
    const { jobs, activities } = makeJobs();

    await jobs.generate({ briefId: 'b4', deliver: false });

    expect(activities.generateContent).toHaveBeenCalledWith({ briefId: 'b4' });
    expect(activities.deliver).not.toHaveBeenCalled();
  });

  // `deliver` is optional on the input; only an explicit `false` suppresses it.
  it('delivers when the input omits deliver entirely', async () => {
    const { jobs, activities } = makeJobs();

    await jobs.generate({ briefId: 'b5' });

    expect(activities.deliver).toHaveBeenCalledWith({ briefId: 'b5' });
  });
});

describe('BriefJobs — briefs.dispatchDue (was DispatchDueBriefsWorkflow)', () => {
  it('enqueues one generate job per claimed brief, carrying its delivery intent', async () => {
    const { jobs, queue } = makeJobs({
      claimDue: jest.fn(async () => ({
        briefs: [
          { briefId: 'b1', organizationId: 'org-1', deliver: false },
          { briefId: 'b2', organizationId: 'org-2', deliver: true },
        ],
      })) as never,
    });

    await jobs.dispatchDue();

    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenNthCalledWith(
      1,
      JOB.generateBrief,
      { briefId: 'b1', deliver: false, organizationId: 'org-1' },
      { id: 'brief:b1', phase: 'generating', organizationId: 'org-1' },
    );
    expect(queue.enqueue).toHaveBeenNthCalledWith(
      2,
      JOB.generateBrief,
      { briefId: 'b2', deliver: true, organizationId: 'org-2' },
      { id: 'brief:b2', phase: 'generating', organizationId: 'org-2' },
    );
  });

  it('enqueues nothing when no schedule is due', async () => {
    const { jobs, queue } = makeJobs();
    await jobs.dispatchDue();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe('BriefJobs — briefs.backfill (was BackfillBriefsWorkflow)', () => {
  it('enqueues a non-delivering generate job per planned brief', async () => {
    const { jobs, activities, queue } = makeJobs({
      planBackfill: jest.fn(async () => ({
        briefs: [
          { briefId: 'h1', organizationId: 'org-1' },
          { briefId: 'h2', organizationId: 'org-1' },
        ],
      })) as never,
    });

    await jobs.backfill({ scheduleId: 's1', backfillMonths: 3 });

    expect(activities.planBackfill).toHaveBeenCalledWith({
      scheduleId: 's1',
      backfillMonths: 3,
    });
    // A backfilled historical period is generated for the dashboard, never
    // sent — the whole reason the old workflow hardcoded deliver: false.
    for (const call of queue.enqueue.mock.calls) {
      expect(call[1]).toMatchObject({ deliver: false });
    }
    expect(
      queue.enqueue.mock.calls.map((c) => (c[2] as { id: string }).id),
    ).toEqual(['brief:h1', 'brief:h2']);
  });
});

describe('BriefJobs — registration', () => {
  it('registers all three brief job types and routes each to its handler', async () => {
    const { jobs, activities, registry } = makeJobs();
    jobs.onModuleInit();

    for (const type of [
      JOB.dispatchDueBriefs,
      JOB.generateBrief,
      JOB.backfillBriefs,
    ]) {
      expect(registry.get(type)).toBeDefined();
    }

    await registry.get(JOB.generateBrief)!({ briefId: 'b9' }, {} as never);
    expect(activities.markGenerating).toHaveBeenCalledWith({ briefId: 'b9' });
  });
});
