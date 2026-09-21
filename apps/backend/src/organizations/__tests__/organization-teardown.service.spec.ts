import { Logger } from '@nestjs/common';

/**
 * The integration service is only ever used as a `ModuleRef` token here, so it
 * is stubbed to a bare class: importing the real one drags in the whole GitHub
 * module graph (and its OpenAI/Octokit clients) to assert nothing.
 */
jest.mock('../../integrations/github/services/installations.service', () => ({
  GithubInstallationsService: class {},
}));

import { OrganizationTeardownService } from '../services/organization-teardown.service';
import { GithubInstallationsService } from '../../integrations/github/services/installations.service';

const ORG_ID = '3f1a9c62-2c1f-4f2e-9a52-4b1d0d5f8e11';

function makeMocks(
  overrides: {
    github?: Record<string, unknown>;
    abort?: jest.Mock;
  } = {},
) {
  const github = {
    listForOrg: jest.fn().mockResolvedValue([{ id: 'gh-1' }]),
    disconnect: jest.fn().mockResolvedValue(undefined),
    ...overrides.github,
  };

  const abortOrganization = overrides.abort ?? jest.fn().mockResolvedValue(2);
  const queue = { abortOrganization } as any;

  const moduleRef = {
    get: jest.fn((token: unknown) => {
      if (token === GithubInstallationsService) return github;
      throw new Error(`unexpected token: ${String(token)}`);
    }),
  } as any;

  return {
    svc: new OrganizationTeardownService(queue, moduleRef),
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

  it('uninstalls GitHub, then drops the org’s jobs', async () => {
    const { svc, github, abortOrganization } = makeMocks();

    await svc.run(ORG_ID);

    // One stored credential per workspace: `disconnect` takes the org alone.
    expect(github.disconnect).toHaveBeenCalledWith(ORG_ID);
    expect(abortOrganization).toHaveBeenCalledWith(ORG_ID);
    // Jobs go last so the collaborator syncs GitHub's disconnect enqueues are
    // caught too.
    expect(github.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      abortOrganization.mock.invocationCallOrder[0],
    );
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
      github: { listForOrg: jest.fn().mockRejectedValue(new Error('gh down')) },
      abort: jest.fn().mockRejectedValue(new Error('db down')),
    });

    await expect(svc.run(ORG_ID)).resolves.toBeUndefined();
  });
});
