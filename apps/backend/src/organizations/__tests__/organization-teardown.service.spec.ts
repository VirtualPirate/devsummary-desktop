/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { Logger } from '@nestjs/common';
import { OrganizationTeardownService } from '../services/organization-teardown.service';
import { GithubInstallationsService } from '../../integrations/github/services/installations.service';
import { SlackInstallationsService } from '../../integrations/slack/services/installations.service';

const ORG_ID = '3f1a9c62-2c1f-4f2e-9a52-4b1d0d5f8e11';

function makeMocks(
  overrides: {
    slack?: Record<string, unknown>;
    github?: Record<string, unknown>;
    list?: unknown;
  } = {},
) {
  const slack = {
    listForOrg: jest.fn().mockResolvedValue([{ id: 'slack-1' }]),
    disconnect: jest.fn().mockResolvedValue(undefined),
    ...overrides.slack,
  };
  const github = {
    listForOrg: jest.fn().mockResolvedValue([{ id: 'gh-1' }]),
    disconnect: jest.fn().mockResolvedValue(undefined),
    ...overrides.github,
  };

  const terminate = jest.fn().mockResolvedValue(undefined);
  const executions = [{ workflowId: 'wf-1', runId: 'run-1' }];
  const client = {
    workflow: {
      list:
        overrides.list ??
        jest.fn(() => ({
          async *[Symbol.asyncIterator]() {
            yield* executions;
          },
        })),
      getHandle: jest.fn(() => ({ terminate })),
    },
  } as any;

  const moduleRef = {
    get: jest.fn((token: unknown) => {
      if (token === SlackInstallationsService) return slack;
      if (token === GithubInstallationsService) return github;
      throw new Error(`unexpected token: ${String(token)}`);
    }),
  } as any;

  return {
    svc: new OrganizationTeardownService(client, moduleRef),
    slack,
    github,
    client,
    terminate,
  };
}

describe('OrganizationTeardownService', () => {
  beforeEach(() => {
    // Every best-effort branch logs at error level; keep the noise out of the
    // test output.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('revokes Slack, uninstalls GitHub, then terminates running workflows', async () => {
    const { svc, slack, github, client, terminate } = makeMocks();

    await svc.run(ORG_ID);

    expect(slack.disconnect).toHaveBeenCalledWith(ORG_ID, 'slack-1');
    expect(github.disconnect).toHaveBeenCalledWith(ORG_ID, 'gh-1');
    // Workflows go last so the collaborator syncs GitHub's disconnect starts
    // are caught too.
    expect(github.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      client.workflow.list.mock.invocationCallOrder[0],
    );
    expect(client.workflow.getHandle).toHaveBeenCalledWith('wf-1', 'run-1');
    expect(terminate).toHaveBeenCalledWith(`organization ${ORG_ID} deleted`);
  });

  it('scopes the visibility query to the org and Running executions', async () => {
    const { svc, client } = makeMocks();

    await svc.run(ORG_ID);

    expect(client.workflow.list).toHaveBeenCalledWith({
      query: `OrganizationId = '${ORG_ID}' AND ExecutionStatus = 'Running'`,
    });
  });

  it('continues past a failing Slack revoke', async () => {
    const { svc, github, terminate } = makeMocks({
      slack: {
        disconnect: jest.fn().mockRejectedValue(new Error('slack down')),
      },
    });

    await expect(svc.run(ORG_ID)).resolves.toBeUndefined();
    expect(github.disconnect).toHaveBeenCalled();
    expect(terminate).toHaveBeenCalled();
  });

  it('continues past a failing GitHub uninstall', async () => {
    const { svc, terminate } = makeMocks({
      github: { listForOrg: jest.fn().mockRejectedValue(new Error('403')) },
    });

    await expect(svc.run(ORG_ID)).resolves.toBeUndefined();
    expect(terminate).toHaveBeenCalled();
  });

  it('resolves even when every step fails, so the org stays deletable', async () => {
    const { svc } = makeMocks({
      slack: {
        listForOrg: jest.fn().mockRejectedValue(new Error('slack down')),
      },
      github: { listForOrg: jest.fn().mockRejectedValue(new Error('gh down')) },
      list: jest.fn(() => {
        throw new Error('visibility down');
      }),
    });

    await expect(svc.run(ORG_ID)).resolves.toBeUndefined();
  });

  it('keeps terminating after one workflow fails to terminate', async () => {
    const terminate = jest
      .fn()
      .mockRejectedValueOnce(new Error('already completed'))
      .mockResolvedValue(undefined);
    const client = {
      workflow: {
        list: jest.fn(() => ({
          async *[Symbol.asyncIterator]() {
            yield { workflowId: 'wf-1', runId: 'run-1' };
            yield { workflowId: 'wf-2', runId: 'run-2' };
          },
        })),
        getHandle: jest.fn(() => ({ terminate })),
      },
    } as any;
    const moduleRef = {
      get: jest.fn(() => ({
        listForOrg: jest.fn().mockResolvedValue([]),
        disconnect: jest.fn(),
      })),
    } as any;

    const svc = new OrganizationTeardownService(client, moduleRef);
    await expect(svc.run(ORG_ID)).resolves.toBeUndefined();
    expect(terminate).toHaveBeenCalledTimes(2);
  });
});
