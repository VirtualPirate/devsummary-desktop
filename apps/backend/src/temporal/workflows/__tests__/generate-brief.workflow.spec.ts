/* eslint-disable @typescript-eslint/require-await -- mock activities must return Promises to satisfy the Activities interface, even when the body has nothing to await */
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { GenerateBriefWorkflow } from '../generate-brief.workflow';

jest.setTimeout(60_000);

type ActivityMap = Record<string, (...args: never[]) => Promise<unknown>>;

describe('GenerateBriefWorkflow', () => {
  let env: TestWorkflowEnvironment;
  let workflowIdCounter = 0;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  });

  afterAll(async () => {
    await env?.teardown();
  });

  async function run(
    activities: ActivityMap,
    input: { briefId: string; deliver?: boolean },
  ) {
    workflowIdCounter += 1;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'test',
      workflowsPath: require.resolve('../generate-brief.workflow'),
      activities,
    });
    await worker.runUntil(
      env.client.workflow.execute(GenerateBriefWorkflow, {
        taskQueue: 'test',
        workflowId: `generate-brief-${workflowIdCounter}`,
        args: [input],
      }),
    );
  }

  it('delivers when markGenerating proceeds, generation is non-terminal, and deliver is not false', async () => {
    const delivered: string[] = [];
    await run(
      {
        'briefs.markGenerating': async () => ({ proceed: true }),
        'briefs.generateContent': async () => ({ terminal: false }),
        'briefs.deliver': async (input: { briefId: string }) => {
          delivered.push(input.briefId);
        },
      },
      { briefId: 'b1', deliver: true },
    );

    expect(delivered).toEqual(['b1']);
  });

  it('does not deliver when markGenerating returns proceed:false', async () => {
    const generateContentCalls: string[] = [];
    const delivered: string[] = [];
    await run(
      {
        'briefs.markGenerating': async () => ({ proceed: false }),
        'briefs.generateContent': async (input: { briefId: string }) => {
          generateContentCalls.push(input.briefId);
          return { terminal: false };
        },
        'briefs.deliver': async (input: { briefId: string }) => {
          delivered.push(input.briefId);
        },
      },
      { briefId: 'b2', deliver: true },
    );

    expect(generateContentCalls).toEqual([]);
    expect(delivered).toEqual([]);
  });

  it('does not deliver when generateContent returns terminal:true', async () => {
    const delivered: string[] = [];
    await run(
      {
        'briefs.markGenerating': async () => ({ proceed: true }),
        'briefs.generateContent': async () => ({ terminal: true }),
        'briefs.deliver': async (input: { briefId: string }) => {
          delivered.push(input.briefId);
        },
      },
      { briefId: 'b3', deliver: true },
    );

    expect(delivered).toEqual([]);
  });

  it('does not deliver when the input requests deliver:false', async () => {
    const delivered: string[] = [];
    await run(
      {
        'briefs.markGenerating': async () => ({ proceed: true }),
        'briefs.generateContent': async () => ({ terminal: false }),
        'briefs.deliver': async (input: { briefId: string }) => {
          delivered.push(input.briefId);
        },
      },
      { briefId: 'b4', deliver: false },
    );

    expect(delivered).toEqual([]);
  });
});
