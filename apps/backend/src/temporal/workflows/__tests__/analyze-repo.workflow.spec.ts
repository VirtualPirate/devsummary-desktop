/* eslint-disable @typescript-eslint/require-await -- mock activities must return Promises to satisfy the Activities interface, even when the body has nothing to await */
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { AnalyzeRepoWorkflow } from '../analyze-repo.workflow';
import { SA_ORG, SA_PHASE } from '../../search-attributes';

jest.setTimeout(60_000);

type ActivityMap = Record<string, (...args: never[]) => Promise<unknown>>;

describe('AnalyzeRepoWorkflow', () => {
  let env: TestWorkflowEnvironment;
  let workflowIdCounter = 0;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
    // The test server rejects a start carrying an unregistered custom attribute
    // ("search attribute OrganizationId is not defined"), exactly like a real
    // cluster — so register them the way SchedulesBootstrap does on API boot.
    // `2` is proto IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD.
    await env.connection.operatorService.addSearchAttributes({
      namespace: 'default',
      searchAttributes: { [SA_ORG]: 2, [SA_PHASE]: 2 },
    });
  });

  afterAll(async () => {
    await env?.teardown();
  });

  async function run(
    activities: ActivityMap,
    input: {
      repositoryId: string;
      sinceISO: string;
      force: boolean;
      organizationId?: string;
    },
  ) {
    workflowIdCounter += 1;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('../analyze-repo.workflow'),
      activities,
    });
    // `start` + `handle.result()` rather than `execute`: the handle carries no
    // runId, so `describe()` afterwards reports the *last* run in the chain —
    // which is how the continued run's search attributes become observable.
    const handle = await env.client.workflow.start(AnalyzeRepoWorkflow, {
      taskQueue: 'test',
      workflowId: `analyze-repo-${workflowIdCounter}`,
      args: [input],
    });
    await worker.runUntil(handle.result());
    return handle;
  }

  it('analyzes every planned commit exactly once', async () => {
    const analyzed: string[] = [];
    await run(
      {
        'analysis.planRepoAnalysis': async () => ({
          commitIds: ['c1', 'c2', 'c3'],
          nextCursor: null,
        }),
        'analysis.analyzeCommit': async (input: { commitId: string }) => {
          analyzed.push(input.commitId);
        },
      },
      { repositoryId: 'r1', sinceISO: '2026-01-01T00:00:00Z', force: false },
    );

    expect(analyzed).toHaveLength(3);
    expect(analyzed.slice().sort()).toEqual(['c1', 'c2', 'c3']);
  });

  // PAGE = 500: a full page means more history is left, and the *cursor* — not
  // the remaining ids — is what continue-as-new carries, so the workflow
  // argument stays two fields wide no matter how large the repository is. The
  // continued run must also re-declare its search attributes: a bare
  // `continueAsNew` sends `searchAttributes: undefined`, which would drop the
  // repo out of its org's `analyzing` count mid-run.
  it('continues as new with the cursor, not the remaining ids, and re-declares its search attributes', async () => {
    const analyzed: string[] = [];
    const cursorsSeen: Array<{ authoredAt: string; id: string } | null> = [];
    const argumentSizes: number[] = [];

    const handle = await run(
      {
        'analysis.planRepoAnalysis': async (input: {
          limit: number;
          after?: { authoredAt: string; id: string } | null;
        }) => {
          cursorsSeen.push(input.after ?? null);
          argumentSizes.push(JSON.stringify(input).length);
          // Two full pages, then a short one that ends the chain.
          const run = cursorsSeen.length;
          if (run > 2) {
            return { commitIds: ['tail'], nextCursor: null };
          }
          return {
            commitIds: Array.from(
              { length: input.limit },
              (_, i) => `p${run}-c${i}`,
            ),
            nextCursor: {
              authoredAt: `2026-01-0${run}T00:00:00.000Z`,
              id: `p${run}-c${input.limit - 1}`,
            },
          };
        },
        'analysis.analyzeCommit': async (input: { commitId: string }) => {
          analyzed.push(input.commitId);
        },
      },
      {
        repositoryId: 'r1',
        sinceISO: '2026-01-01T00:00:00Z',
        force: false,
        organizationId: 'org-1',
      },
    );

    expect(cursorsSeen).toEqual([
      null,
      { authoredAt: '2026-01-01T00:00:00.000Z', id: 'p1-c499' },
      { authoredAt: '2026-01-02T00:00:00.000Z', id: 'p2-c499' },
    ]);
    expect(analyzed).toHaveLength(1001);
    expect(new Set(analyzed).size).toBe(1001);
    // The point of the cursor: what crosses the boundary does not grow with the
    // repository. 1001 commit ids would be ~14 KB.
    expect(Math.max(...argumentSizes)).toBeLessThan(300);

    const desc = await handle.describe();
    expect(desc.searchAttributes).toMatchObject({
      OrganizationId: ['org-1'],
      Phase: ['analyzing'],
    });
  });
});
