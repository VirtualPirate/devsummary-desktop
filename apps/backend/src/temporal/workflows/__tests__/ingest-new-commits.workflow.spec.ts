/* eslint-disable @typescript-eslint/require-await -- mock activities must return Promises to satisfy the Activities interface, even when the body has nothing to await */
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import {
  IngestNewCommitsWorkflow,
  type IngestNewCommitsInput,
} from '../ingest-new-commits.workflow';
import { SA_ORG, SA_PHASE } from '../../search-attributes';

jest.setTimeout(60_000);

type ActivityMap = Record<string, (...args: never[]) => Promise<unknown>>;

/**
 * Orchestration only: which activity ran with what, and whether the analysis child
 * started. The gate logic itself is unit-tested on `CommitBackfillService`.
 *
 * The branch that matters here is `adopt` — a branch with no stored history has no
 * `sinceISO` to fetch from, so the workflow has to switch to the lookback-bounded
 * first read instead, and must not start an analysis child when even that finds
 * nothing.
 */
describe('IngestNewCommitsWorkflow', () => {
  let env: TestWorkflowEnvironment;
  let counter = 0;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    await env.connection.operatorService.addSearchAttributes({
      namespace: 'default',
      searchAttributes: { [SA_ORG]: 2, [SA_PHASE]: 2 },
    });
  });

  afterAll(async () => {
    await env?.teardown();
  });

  async function run(activities: ActivityMap, input: IngestNewCommitsInput) {
    counter += 1;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('../ingest-new-commits.workflow'),
      activities,
    });
    const handle = await env.client.workflow.start(IngestNewCommitsWorkflow, {
      taskQueue: 'test',
      workflowId: `ingest-new-commits-${counter}`,
      args: [input],
    });
    await worker.runUntil(handle.result());
    return handle;
  }

  /**
   * `runKey` is per test on purpose: it is also the analysis child's workflow id,
   * and two tests sharing one would make the second fail with
   * `WorkflowExecutionAlreadyStartedError` — the same collision the id guards
   * against in production.
   */
  const sweepWith = (runKey: string): IngestNewCommitsInput => ({
    repositoryId: 'r1',
    branch: 'main',
    trigger: 'sweep',
    runKey,
    organizationId: 'org-1',
  });

  function spies() {
    const calls: Array<{ activity: string; input: unknown }> = [];
    const record =
      (activity: string, result: unknown) => async (input: unknown) => {
        calls.push({ activity, input });
        return result;
      };
    return { calls, record };
  }

  it('resumes from the planned window without a lookback read', async () => {
    const { calls, record } = spies();

    await run(
      {
        'commits.planIngest': record('plan', {
          skip: null,
          mode: 'resume',
          sinceISO: '2026-08-13T16:04:00.000Z',
        }),
        'commits.backfill': record('backfill', { inserted: 3 }),
        'commits.backfillFromLatest': record('backfillFromLatest', {
          inserted: 0,
          sinceISO: null,
        }),
      },
      sweepWith('2026-08-14-resume'),
    );

    expect(calls.map((c) => c.activity)).toEqual(['plan', 'backfill']);
    expect(calls[1].input).toMatchObject({
      sinceISO: '2026-08-13T16:04:00.000Z',
    });
  });

  it('adopts a branch with no stored history via a bounded lookback read', async () => {
    const { calls, record } = spies();

    await run(
      {
        'commits.planIngest': record('plan', { skip: null, mode: 'adopt' }),
        'commits.backfill': record('backfill', { inserted: 0 }),
        'commits.backfillFromLatest': record('backfillFromLatest', {
          inserted: 12,
          sinceISO: '2026-07-15T00:00:00.000Z',
        }),
      },
      sweepWith('2026-08-14-adopt'),
    );

    expect(calls.map((c) => c.activity)).toEqual([
      'plan',
      'backfillFromLatest',
    ]);
    // Bounded: the adopted read carries a lookback, not "everything".
    expect(calls[1].input).toMatchObject({
      repositoryId: 'r1',
      branch: 'main',
      lookbackDays: 30,
    });
  });

  it('makes no GitHub call at all when the plan skips', async () => {
    const { calls, record } = spies();

    await run(
      {
        'commits.planIngest': record('plan', { skip: 'nothing-new' }),
        'commits.backfill': record('backfill', { inserted: 0 }),
        'commits.backfillFromLatest': record('backfillFromLatest', {
          inserted: 0,
          sinceISO: null,
        }),
      },
      sweepWith('2026-08-14-skip'),
    );

    expect(calls.map((c) => c.activity)).toEqual(['plan']);
  });

  // A genuinely empty repository: adopted, GitHub reports no commits, so there is
  // nothing to analyse and no window to hand a child.
  it('starts no analysis child when an adopted branch turns out to be empty', async () => {
    const { calls, record } = spies();

    const handle = await run(
      {
        'commits.planIngest': record('plan', { skip: null, mode: 'adopt' }),
        'commits.backfillFromLatest': record('backfillFromLatest', {
          inserted: 0,
          sinceISO: null,
        }),
      },
      sweepWith('2026-08-14-adopt-empty'),
    );

    expect(calls.map((c) => c.activity)).toEqual([
      'plan',
      'backfillFromLatest',
    ]);
    const history = await handle.fetchHistory();
    const startedChild = (history.events ?? []).some(
      (event) => event.startChildWorkflowExecutionInitiatedEventAttributes,
    );
    expect(startedChild).toBe(false);
  });
});
