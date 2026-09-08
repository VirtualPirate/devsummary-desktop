import { Logger } from '@nestjs/common';

/**
 * The two integration services are only ever used as `ModuleRef` tokens here, so
 * they are stubbed to a bare class: importing the real ones drags in the whole
 * GitHub/Slack module graph (and its OpenAI/Octokit clients) to assert nothing.
 */
jest.mock('../../integrations/github/services/installations.service', () => ({
  GithubInstallationsService: class {},
}));
jest.mock('../../integrations/slack/services/installations.service', () => ({
  SlackInstallationsService: class {},
}));

import { OrganizationTeardownService } from '../services/organization-teardown.service';
import { GithubInstallationsService } from '../../integrations/github/services/installations.service';
import { SlackInstallationsService } from '../../integrations/slack/services/installations.service';

const ORG_ID = '3f1a9c62-2c1f-4f2e-9a52-4b1d0d5f8e11';

function makeMocks(
  overrides: {
    slack?: Record<string, unknown>;
    github?: Record<string, unknown>;
    abort?: jest.Mock;
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

  const abortOrganization = overrides.abort ?? jest.fn().mockResolvedValue(2);
  const queue = { abortOrganization } as any;

  const moduleRef = {
    get: jest.fn((token: unknown) => {
      if (token === SlackInstallationsService) return slack;
      if (token === GithubInstallationsService) return github;
      throw new Error(`unexpected token: ${String(token)}`);
    }),
  } as any;

  return {
    svc: new OrganizationTeardownService(queue, moduleRef),
    slack,
    github,
    abortOrganization,
  };
}

describe('OrganizationTeardownService', () => {
  beforeEach(() => {
    // Every best-effort branch logs; keep the noise out of the test output.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('revokes Slack, uninstalls GitHub, then drops the org’s jobs', async () => {
    const { svc, slack, github, abortOrganization } = makeMocks();

    await svc.run(ORG_ID);

    expect(slack.disconnect).toHaveBeenCalledWith(ORG_ID, 'slack-1');
    // One stored credential per workspace: `disconnect` takes the org alone.
    expect(github.disconnect).toHaveBeenCalledWith(ORG_ID);
    expect(abortOrganization).toHaveBeenCalledWith(ORG_ID);
    // Jobs go last so the collaborator syncs GitHub's disconnect enqueues are
    // caught too.
    expect(github.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      abortOrganization.mock.invocationCallOrder[0],
    );
  });

  it('continues past a failing Slack revoke', async () => {
    const { svc, github, abortOrganization } = makeMocks({
      slack: {
        disconnect: jest.fn().mockRejectedValue(new Error('slack down')),
      },
    });

    await expect(svc.run(ORG_ID)).resolves.toBeUndefined();
    expect(github.disconnect).toHaveBeenCalled();
    expect(abortOrganization).toHaveBeenCalled();
  });

  it('continues past a failing GitHub uninstall', async () => {
    const { svc, abortOrganization } = makeMocks({
      github: { listForOrg: jest.fn().mockRejectedValue(new Error('403')) },
    });

    await expect(svc.run(ORG_ID)).resolves.toBeUndefined();
    expect(abortOrganization).toHaveBeenCalled();
  });

  it('resolves even when every step fails, so the org stays deletable', async () => {
    const { svc } = makeMocks({
      slack: {
        listForOrg: jest.fn().mockRejectedValue(new Error('slack down')),
      },
      github: { listForOrg: jest.fn().mockRejectedValue(new Error('gh down')) },
      abort: jest.fn().mockRejectedValue(new Error('db down')),
    });

    await expect(svc.run(ORG_ID)).resolves.toBeUndefined();
  });
});
