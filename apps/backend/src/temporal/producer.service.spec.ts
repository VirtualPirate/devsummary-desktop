/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { TemporalProducerService } from './producer.service';

function makeService() {
  const started: any[] = [];
  const client = {
    workflow: {
      start: jest.fn(async (type: string, opts: any) => {
        started.push({ type, opts });
        return { workflowId: opts.workflowId ?? 'generated-id' };
      }),
    },
  } as any;
  const svc = new TemporalProducerService(client, {
    address: 'x',
    namespace: 'default',
    taskQueue: 'launchstack',
    maxConcurrentActivities: 20,
    maxConcurrentWorkflowTasks: 20,
  });
  return { svc, client, started };
}

describe('TemporalProducerService', () => {
  it('starts a workflow and returns its workflowId', async () => {
    const { svc, started } = makeService();
    const id = await svc.start('GenerateBriefWorkflow', {
      args: [{ briefId: 'b1' }],
      workflowId: 'wf-1',
    });
    expect(id).toBe('wf-1');
    expect(started[0].opts.taskQueue).toBe('launchstack');
    expect(started[0].opts.args).toEqual([{ briefId: 'b1' }]);
  });

  it('startDeduped sets USE_EXISTING conflict policy', async () => {
    const { svc, started } = makeService();
    await svc.startDeduped('ScanRepositoryWorkflow', {
      args: [{ repositoryId: 'r1' }],
      workflowId: 'scan:r1',
    });
    expect(started[0].opts.workflowIdConflictPolicy).toBe('USE_EXISTING');
  });

  it('generates a workflowId of the form `${type}:...` when none is supplied', async () => {
    const { svc, started } = makeService();
    await svc.start('GenerateBriefWorkflow', { args: [{ briefId: 'b1' }] });
    expect(started[0].opts.workflowId).toEqual(
      expect.stringMatching(/^GenerateBriefWorkflow:/),
    );
  });

  it('startDeduped rejects when no workflowId is supplied', async () => {
    const { svc } = makeService();
    await expect(
      svc.startDeduped('ScanRepositoryWorkflow', {
        args: [{ repositoryId: 'r1' }],
      }),
    ).rejects.toThrow('startDeduped requires a workflowId');
  });
});
