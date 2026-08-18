/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { JobActivityService } from './job-activity.service';

// The service only queries for ids that Temporal could plausibly have stored,
// so every counting test has to carry a real uuid.
const ORG_ID = '3f1a9c62-2c1f-4f2e-9a52-4b1d0d5f8e11';

function svcWith(counts: Record<string, number>) {
  const client = {
    workflow: {
      count: jest.fn((query: string) => {
        const phase = /Phase = '(\w+)'/.exec(query)?.[1] ?? '';
        return Promise.resolve({ count: counts[phase] ?? 0 });
      }),
    },
  } as any;
  return { svc: new JobActivityService(client), client };
}

describe('JobActivityService', () => {
  it('aggregates per-phase running counts', async () => {
    const { svc } = svcWith({ fetching: 2, analyzing: 1, generating: 0 });
    const out = await svc.forOrganization(ORG_ID);
    expect(out).toEqual({
      fetching: 2,
      analyzing: 1,
      generating: 0,
      active: true,
    });
  });

  it('active is false when all zero', async () => {
    const { svc } = svcWith({ fetching: 0, analyzing: 0, generating: 0 });
    const out = await svc.forOrganization(ORG_ID);
    expect(out).toEqual({
      fetching: 0,
      analyzing: 0,
      generating: 0,
      active: false,
    });
  });

  it('degrades to empty on error', async () => {
    const client = {
      workflow: {
        count: jest.fn(() => Promise.reject(new Error('down'))),
      },
    } as any;
    const svc = new JobActivityService(client);
    expect(await svc.forOrganization(ORG_ID)).toEqual({
      active: false,
      fetching: 0,
      analyzing: 0,
      generating: 0,
    });
  });

  it('fails closed on a non-uuid org id without querying', async () => {
    const { svc, client } = svcWith({
      fetching: 2,
      analyzing: 1,
      generating: 0,
    });
    expect(await svc.forOrganization('org-1')).toEqual({
      active: false,
      fetching: 0,
      analyzing: 0,
      generating: 0,
    });
    expect(client.workflow.count).not.toHaveBeenCalled();
  });

  it('queries with the organization id, running status, and phase', async () => {
    const { svc, client } = svcWith({
      fetching: 1,
      analyzing: 0,
      generating: 0,
    });
    await svc.forOrganization(ORG_ID);

    const queries = client.workflow.count.mock.calls.map(
      (call: [string]) => call[0],
    );
    const fetchingQuery = queries.find((q: string) =>
      q.includes("Phase = 'fetching'"),
    );

    expect(fetchingQuery).toBeDefined();
    expect(fetchingQuery).toContain(`OrganizationId = '${ORG_ID}'`);
    expect(fetchingQuery).toContain("ExecutionStatus = 'Running'");
    expect(fetchingQuery).toContain("Phase = 'fetching'");
  });
});
