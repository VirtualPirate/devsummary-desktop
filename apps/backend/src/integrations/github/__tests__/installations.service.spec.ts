import { Octokit } from '@octokit/core';
import { openGithubToken } from '../credentials';
import { GithubInstallationsService } from '../services/installations.service';

import { JOB } from '../../../jobs';
import type { SecretsService } from '../../../local/settings/secrets.service';

const USER = {
  id: 4242,
  login: 'acme',
  type: 'User',
  avatar_url: 'https://avatars.example/acme',
};

const kit = () =>
  Octokit as unknown as { request: jest.Mock; iterator: jest.Mock };

function repoPage(...repos: Array<{ id: number; full_name: string }>) {
  return () => ({
    async *[Symbol.asyncIterator]() {
      yield {
        data: repos.map((r) => ({
          id: r.id,
          name: r.full_name.split('/')[1],
          full_name: r.full_name,
          private: false,
        })),
      };
    },
  });
}

function repoRow(id = 'repo-1') {
  return {
    id,
    installationId: 'inst-1',
    githubRepoId: 10n,
    name: 'api',
    fullName: 'acme/api',
    private: false,
  } as any;
}

function installationRow(over: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    organizationId: 'org-1',
    githubInstallationId: BigInt(USER.id),
    githubAccountId: BigInt(USER.id),
    githubAccountLogin: USER.login,
    githubAccountType: 'User',
    githubAccountAvatarUrl: USER.avatar_url,
    targetType: 'User',
    suspendedAt: null,
    connectedByUserId: null,
    raw: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...over,
  } as any;
}

function makeMocks() {
  const installsRepo = {
    findById: jest.fn(async () => installationRow()),
    findActiveByGithubInstallationId: jest.fn(async () => null),
    findRevivableByGithubInstallationId: jest.fn(async () => null),
    findByIdScopedToOrg: jest.fn(async () => installationRow()),
    listByOrganization: jest.fn(async () => [] as any[]),
    create: jest.fn(async (input: any) => installationRow(input)),
    updateCredential: jest.fn(),
    softDelete: jest.fn(),
    undelete: jest.fn(),
  } as any;

  const reposRepo = {
    listByInstallation: jest.fn(async () => [] as Array<{ id: string }>),
    reconcileForInstallation: jest.fn(),
    softDeleteAllForInstallation: jest.fn(),
  } as any;

  const trackedBranches = {
    listByRepositories: jest.fn(async () => new Map<string, string[]>()),
  } as any;

  const client = {
    listInstallationRepos: jest.fn(async () => []),
  } as any;

  const db = {
    transaction: jest.fn(() => ({
      execute: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ __tx: true }),
    })),
  } as any;

  const queue = {
    enqueue: jest.fn(async () => 'job-id'),
  } as any;

  const secrets = {
    update: jest.fn(),
  } as unknown as SecretsService;

  return {
    installsRepo,
    reposRepo,
    trackedBranches,
    client,
    db,
    queue,
    secrets,
  };
}

function makeService(overrides: Partial<ReturnType<typeof makeMocks>> = {}) {
  const m = { ...makeMocks(), ...overrides };
  return {
    svc: new GithubInstallationsService(
      m.installsRepo,
      m.reposRepo,
      m.trackedBranches,
      m.client,
      m.db,
      m.queue,
      m.secrets,
    ),
    mocks: m,
  };
}

describe('GithubInstallationsService', () => {
  beforeEach(() => {
    (Octokit as unknown as { __reset: () => void }).__reset();
    kit().request.mockResolvedValue({ data: USER });
    kit().iterator.mockImplementation(
      repoPage({ id: 10, full_name: 'acme/api' }),
    );
  });

  describe('connect', () => {
    it('validates the token, stores it encrypted, and reconciles repos', async () => {
      const { svc, mocks } = makeService();
      mocks.reposRepo.listByInstallation.mockResolvedValue([repoRow()]);

      const result = await svc.connect({
        orgId: 'org-1',
        token: '  github_pat_secret  ',
      });

      expect(kit().request).toHaveBeenCalledWith('GET /user');
      expect(kit().iterator).toHaveBeenCalledWith(
        'GET /user/repos',
        expect.objectContaining({ per_page: 100 }),
      );

      const created = mocks.installsRepo.create.mock.calls[0][0];
      expect(created).toMatchObject({
        organizationId: 'org-1',
        githubInstallationId: BigInt(USER.id),
        githubAccountId: BigInt(USER.id),
        githubAccountLogin: 'acme',
        githubAccountType: 'User',
      });
      // Encrypted at rest, and whitespace-trimmed on the way in.
      expect(created.raw.token).not.toContain('github_pat_secret');
      expect(openGithubToken(created.raw)).toBe('github_pat_secret');

      expect(mocks.reposRepo.reconcileForInstallation).toHaveBeenCalledWith(
        'inst-1',
        [
          expect.objectContaining({
            githubRepoId: 10n,
            fullName: 'acme/api',
          }),
        ],
        expect.anything(),
      );
      expect(result).toMatchObject({
        accountLogin: 'acme',
        githubInstallationId: String(USER.id),
      });
    });

    it('starts collaborator sync for newly connected repos and nothing else', async () => {
      const { svc, mocks } = makeService();
      mocks.reposRepo.listByInstallation.mockResolvedValue([repoRow()]);

      await svc.connect({ orgId: 'org-1', token: 't' });

      // Invariant: a repository with no tracked branch is inert — connecting
      // must not fetch commits or spend OpenAI tokens.
      expect(mocks.queue.enqueue).toHaveBeenCalledTimes(1);
      expect(mocks.queue.enqueue).toHaveBeenCalledWith(
        JOB.syncRepoCollaborators,
        {
          repositoryId: 'repo-1',
          trigger: 'connected',
          organizationId: 'org-1',
        },
        expect.objectContaining({ phase: 'fetching', organizationId: 'org-1' }),
      );
    });

    it('rejects an invalid token as a 400 and stores nothing', async () => {
      const { svc, mocks } = makeService();
      kit().request.mockRejectedValue(
        Object.assign(new Error('Bad credentials'), { status: 401 }),
      );

      await expect(
        svc.connect({ orgId: 'org-1', token: 'nope' }),
      ).rejects.toMatchObject({ status: 400 });

      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
      expect(mocks.reposRepo.reconcileForInstallation).not.toHaveBeenCalled();
    });

    it('rejects a token that cannot list repositories', async () => {
      const { svc, mocks } = makeService();
      kit().iterator.mockImplementation(() => ({
        async *[Symbol.asyncIterator]() {
          throw Object.assign(new Error('Resource not accessible'), {
            status: 403,
          });
        },
      }));

      await expect(
        svc.connect({ orgId: 'org-1', token: 'ro' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
    });

    it('updates the existing row when the token is re-pasted', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue(
        installationRow(),
      );

      await svc.connect({ orgId: 'org-1', token: 'rotated' });

      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
      const [id, update] = mocks.installsRepo.updateCredential.mock.calls[0];
      expect(id).toBe('inst-1');
      expect(openGithubToken(update.raw)).toBe('rotated');
    });

    it('revives a soft-deleted row for the same workspace', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findRevivableByGithubInstallationId.mockResolvedValue(
        installationRow({ deletedAt: new Date('2026-02-01T00:00:00Z') }),
      );

      await svc.connect({ orgId: 'org-1', token: 't' });

      expect(mocks.installsRepo.undelete).toHaveBeenCalledWith(
        'inst-1',
        expect.anything(),
      );
      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
    });

    it('refuses an account already connected to another workspace', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue(
        installationRow({ organizationId: 'other-org' }),
      );

      await expect(
        svc.connect({ orgId: 'org-1', token: 't' }),
      ).rejects.toMatchObject({
        code: 'GITHUB_INSTALLATION_ALREADY_CONNECTED',
      });
      expect(mocks.reposRepo.reconcileForInstallation).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('soft-deletes the credential and its repositories', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.listByOrganization.mockResolvedValue([
        installationRow(),
      ]);
      mocks.reposRepo.listByInstallation.mockResolvedValue([repoRow()]);

      await svc.disconnect('org-1');

      expect(mocks.reposRepo.softDeleteAllForInstallation).toHaveBeenCalledWith(
        'inst-1',
        expect.anything(),
      );
      expect(mocks.installsRepo.softDelete).toHaveBeenCalledWith(
        'inst-1',
        expect.anything(),
      );
      expect(mocks.queue.enqueue).toHaveBeenCalledWith(
        JOB.syncRepoCollaborators,
        {
          repositoryId: 'repo-1',
          trigger: 'disconnected',
          organizationId: 'org-1',
        },
        expect.objectContaining({ phase: 'fetching', organizationId: 'org-1' }),
      );
    });

    it('404s when nothing is connected', async () => {
      const { svc } = makeService();

      await expect(svc.disconnect('org-1')).rejects.toMatchObject({
        code: 'GITHUB_INSTALLATION_NOT_FOUND',
      });
    });
  });

  describe('sync', () => {
    it('reconciles repos through the stored credential', async () => {
      const { svc, mocks } = makeService();
      mocks.client.listInstallationRepos.mockResolvedValue([
        {
          githubRepoId: '10',
          name: 'api',
          fullName: 'acme/api',
          private: false,
          raw: { id: 10 },
        },
      ]);

      await svc.sync('org-1', 'inst-1');

      expect(mocks.client.listInstallationRepos).toHaveBeenCalledWith(
        BigInt(USER.id),
      );
      expect(mocks.reposRepo.reconcileForInstallation).toHaveBeenCalledWith(
        'inst-1',
        [expect.objectContaining({ githubRepoId: 10n })],
      );
    });

    it('404s for an installation outside the workspace', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue(null);

      await expect(svc.sync('org-1', 'inst-1')).rejects.toMatchObject({
        code: 'GITHUB_INSTALLATION_NOT_FOUND',
      });
    });
  });
});
