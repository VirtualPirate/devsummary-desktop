import { GithubInstallationsService } from '../services/installations.service';
import { WORKFLOW } from '../../../temporal';

function makeMocks() {
  const installsRepo = {
    findById: jest.fn(),
    findActiveByGithubInstallationId: jest.fn(),
    findRevivableByGithubInstallationId: jest.fn(),
    findByIdScopedToOrg: jest.fn(),
    listByOrganization: jest.fn(),
    create: jest.fn(),
    softDelete: jest.fn(),
    undelete: jest.fn(),
  } as any;

  const reposRepo = {
    listByInstallation: jest.fn(async () => [] as Array<{ id: string }>),
    reconcileForInstallation: jest.fn(),
    softDeleteAllForInstallation: jest.fn(),
  } as any;

  const trackedBranches = {
    listByRepository: jest.fn(async () => [] as string[]),
    listByRepositories: jest.fn(async () => new Map<string, string[]>()),
    replaceForRepository: jest.fn(),
  } as any;

  const stateToken = {
    sign: jest.fn(() => 'signed-token'),
    verify: jest.fn(),
  } as any;

  const client = {
    getInstallation: jest.fn(),
    listInstallationRepos: jest.fn(),
    deleteInstallation: jest.fn(),
  } as any;

  const config = {
    appId: '1',
    slug: 'gitbrief',
    privateKey: 'pk',
    webhookSecret: 'w',
  };

  const db = {
    transaction: jest.fn(() => ({
      execute: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ __tx: true }),
    })),
  } as any;

  const temporal = {
    start: jest.fn(async () => 'wf-id'),
    startDeduped: jest.fn(async () => 'wf-id'),
  } as any;

  return {
    installsRepo,
    reposRepo,
    trackedBranches,
    stateToken,
    client,
    config,
    db,
    temporal,
  };
}

function makeService(overrides: Partial<ReturnType<typeof makeMocks>> = {}) {
  const m = { ...makeMocks(), ...overrides };
  return {
    svc: new GithubInstallationsService(
      m.installsRepo,
      m.reposRepo,
      m.trackedBranches,
      m.stateToken,
      m.client,
      m.config,
      m.db,
      m.temporal,
    ),
    mocks: m,
  };
}

function makeRawRepo(id: number, fullName: string, isPrivate: boolean) {
  return {
    githubRepoId: id.toString(),
    name: fullName.split('/').pop()!,
    fullName,
    private: isPrivate,
    raw: {
      id,
      full_name: fullName,
      html_url: `https://github.com/${fullName}`,
    },
  };
}

describe('GithubInstallationsService', () => {
  describe('buildInstallUrl', () => {
    it('throws when config is null', () => {
      const { svc } = makeService({ config: null as any });
      expect(() => svc.buildInstallUrl({ orgId: 'o', userId: 'u' })).toThrow(
        /not configured/i,
      );
    });

    it('returns github install url with signed state', () => {
      const { svc, mocks } = makeService();
      const url = svc.buildInstallUrl({ orgId: 'o1', userId: 'u1' });

      expect(mocks.stateToken.sign).toHaveBeenCalledWith({
        orgId: 'o1',
        userId: 'u1',
      });
      expect(url).toBe(
        'https://github.com/apps/gitbrief/installations/new?state=signed-token',
      );
    });
  });

  describe('handleCallback', () => {
    it('rejects when state user does not match session user', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({
        orgId: 'o1',
        userId: 'other',
      });

      await expect(
        svc.handleCallback({
          state: 't',
          installationId: 1n,
          setupAction: 'install',
          sessionUserId: 'u1',
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('upserts installation + repos on install', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({
        orgId: 'o1',
        userId: 'u1',
      });
      // Neither a live row nor a revivable one for this org: fresh install.
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue(
        null,
      );
      mocks.installsRepo.findRevivableByGithubInstallationId.mockResolvedValue(
        null,
      );
      mocks.client.getInstallation.mockResolvedValue({
        githubInstallationId: '42',
        githubAccountId: '7',
        accountLogin: 'acme',
        accountType: 'Organization',
        accountAvatarUrl: null,
        targetType: 'Organization',
        suspendedAt: null,
        raw: { id: 42, account: { login: 'acme' } },
      });
      mocks.client.listInstallationRepos.mockResolvedValue([
        makeRawRepo(10, 'acme/a', true),
      ]);
      mocks.installsRepo.create.mockResolvedValue({
        id: 'inst-uuid',
        organizationId: 'o1',
      });

      await svc.handleCallback({
        state: 't',
        installationId: 42n,
        setupAction: 'install',
        sessionUserId: 'u1',
      });

      expect(mocks.installsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'o1',
          githubInstallationId: 42n,
          githubAccountLogin: 'acme',
          githubAccountType: 'Organization',
          connectedByUserId: 'u1',
        }),
        expect.anything(),
      );
      expect(mocks.reposRepo.reconcileForInstallation).toHaveBeenCalledWith(
        'inst-uuid',
        [
          expect.objectContaining({
            githubRepoId: 10n,
            fullName: 'acme/a',
            raw: expect.anything(),
          }),
        ],
        expect.anything(),
      );
    });

    it('on setup_action=update re-syncs repos for existing installation', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({
        orgId: 'o1',
        userId: 'u1',
      });
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue({
        id: 'existing-uuid',
        organizationId: 'o1',
      });
      mocks.client.listInstallationRepos.mockResolvedValue([]);

      await svc.handleCallback({
        state: 't',
        installationId: 42n,
        setupAction: 'update',
        sessionUserId: 'u1',
      });

      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
      expect(mocks.reposRepo.reconcileForInstallation).toHaveBeenCalledWith(
        'existing-uuid',
        [],
        expect.anything(),
      );
    });

    it('on setup_action=update without state re-syncs existing installation', async () => {
      const { svc, mocks } = makeService();
      // Stateless Configure derives the org from the live row.
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue({
        id: 'existing-uuid',
        organizationId: 'o1',
      });
      mocks.client.listInstallationRepos.mockResolvedValue([
        makeRawRepo(10, 'acme/a', true),
      ]);

      const result = await svc.handleCallback({
        state: undefined,
        installationId: 42n,
        setupAction: 'update',
        sessionUserId: null,
      });

      expect(mocks.stateToken.verify).not.toHaveBeenCalled();
      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
      expect(mocks.reposRepo.reconcileForInstallation).toHaveBeenCalledWith(
        'existing-uuid',
        [
          expect.objectContaining({
            githubRepoId: 10n,
            fullName: 'acme/a',
            raw: expect.anything(),
          }),
        ],
        expect.anything(),
      );
      expect(result).toEqual({ orgId: 'o1' });
    });

    it('rejects stateless callback when no installation exists', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue(
        undefined,
      );

      await expect(
        svc.handleCallback({
          state: undefined,
          installationId: 42n,
          setupAction: 'update',
          sessionUserId: null,
        }),
      ).rejects.toMatchObject({ code: 'GITHUB_STATE_INVALID' });
    });

    it('rejects stateless callback for setup_action=install', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue({
        id: 'existing-uuid',
        organizationId: 'o1',
      });

      await expect(
        svc.handleCallback({
          state: undefined,
          installationId: 42n,
          setupAction: 'install',
          sessionUserId: null,
        }),
      ).rejects.toMatchObject({ code: 'GITHUB_STATE_INVALID' });
    });

    it('rejects the stateless Configure path when only a soft-deleted row exists', async () => {
      const { svc, mocks } = makeService();
      // No live row to derive the org from — the only row is disconnected, and a
      // stateless callback carries no state token to fall back on.
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue(
        null,
      );
      mocks.installsRepo.findRevivableByGithubInstallationId.mockResolvedValue({
        id: 'existing-uuid',
        organizationId: 'o1',
        deletedAt: new Date('2026-05-10T00:00:00Z'),
      });

      await expect(
        svc.handleCallback({
          state: undefined,
          installationId: 42n,
          setupAction: 'update',
          sessionUserId: null,
        }),
      ).rejects.toMatchObject({ code: 'GITHUB_STATE_INVALID' });

      // Bails before it could ever pick an org to revive the row into.
      expect(
        mocks.installsRepo.findRevivableByGithubInstallationId,
      ).not.toHaveBeenCalled();
      expect(mocks.installsRepo.undelete).not.toHaveBeenCalled();
      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
      expect(mocks.reposRepo.reconcileForInstallation).not.toHaveBeenCalled();
    });

    it('409s when the GitHub account is already connected to another org', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({
        orgId: 'o2',
        userId: 'u2',
      });
      // Live row, owned by a different DevSummary org.
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue({
        id: 'existing-uuid',
        organizationId: 'o1',
        githubInstallationId: 42n,
        deletedAt: null,
      });

      await expect(
        svc.handleCallback({
          state: 't',
          installationId: 42n,
          setupAction: 'install',
          sessionUserId: 'u2',
        }),
      ).rejects.toMatchObject({
        code: 'GITHUB_INSTALLATION_ALREADY_CONNECTED',
        status: 409,
      });

      // Nothing may be written for either org...
      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
      expect(mocks.installsRepo.undelete).not.toHaveBeenCalled();
      expect(mocks.reposRepo.reconcileForInstallation).not.toHaveBeenCalled();
      // ...and no workflow may be started under either org id.
      expect(mocks.temporal.start).not.toHaveBeenCalled();
      expect(mocks.temporal.startDeduped).not.toHaveBeenCalled();
      // The 409 is decided on the live row alone; no revive is even considered.
      expect(
        mocks.installsRepo.findRevivableByGithubInstallationId,
      ).not.toHaveBeenCalled();
      // The App stays installed on the GitHub account: the installation belongs
      // to org o1, and GitHub issues one per (app, account), so uninstalling to
      // "clean up" o2's failed connect would break o1's ingestion.
      expect(mocks.client.deleteInstallation).not.toHaveBeenCalled();
    });

    it('connects for a new org when another org only holds a soft-deleted row', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({
        orgId: 'o2',
        userId: 'u2',
      });
      // Org A disconnected, so its row is soft-deleted and holds no claim on the
      // installation id — the partial unique index exists precisely so org B can
      // take it over. No live row, and nothing revivable *for org B*.
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue(
        null,
      );
      mocks.installsRepo.findRevivableByGithubInstallationId.mockResolvedValue(
        null,
      );
      mocks.client.getInstallation.mockResolvedValue({
        githubInstallationId: '42',
        githubAccountId: '7',
        accountLogin: 'acme',
        accountType: 'Organization',
        accountAvatarUrl: null,
        targetType: 'Organization',
        suspendedAt: null,
        raw: { id: 42, account: { login: 'acme' } },
      });
      mocks.client.listInstallationRepos.mockResolvedValue([
        makeRawRepo(10, 'acme/a', true),
      ]);
      mocks.installsRepo.create.mockResolvedValue({
        id: 'new-uuid',
        organizationId: 'o2',
      });

      const result = await svc.handleCallback({
        state: 't',
        installationId: 42n,
        setupAction: 'install',
        sessionUserId: 'u2',
      });

      expect(result).toEqual({ orgId: 'o2' });
      // The revive lookup is scoped to the connecting org, which is what keeps
      // org A's disconnected row out of reach.
      expect(
        mocks.installsRepo.findRevivableByGithubInstallationId,
      ).toHaveBeenCalledWith(42n, 'o2');
      // A brand-new row for org B, not a resurrection of org A's.
      expect(mocks.installsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'o2',
          githubInstallationId: 42n,
          connectedByUserId: 'u2',
        }),
        expect.anything(),
      );
      expect(mocks.installsRepo.undelete).not.toHaveBeenCalled();
      expect(mocks.reposRepo.reconcileForInstallation).toHaveBeenCalledWith(
        'new-uuid',
        [expect.objectContaining({ githubRepoId: 10n, fullName: 'acme/a' })],
        expect.anything(),
      );
    });

    it('leaves the stateless Configure path alone whichever org owns the row', async () => {
      const { svc, mocks } = makeService();
      // No state token, so orgId comes from the live row itself — never a
      // mismatch.
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue({
        id: 'existing-uuid',
        organizationId: 'o2',
        deletedAt: null,
      });
      mocks.client.listInstallationRepos.mockResolvedValue([]);

      const result = await svc.handleCallback({
        state: undefined,
        installationId: 42n,
        setupAction: 'update',
        sessionUserId: null,
      });

      expect(result).toEqual({ orgId: 'o2' });
      expect(mocks.reposRepo.reconcileForInstallation).toHaveBeenCalledWith(
        'existing-uuid',
        [],
        expect.anything(),
      );
    });

    it('un-deletes a previously-disconnected installation on re-install', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({
        orgId: 'o1',
        userId: 'u1',
      });
      // No live row — this org's own row is soft-deleted, so it is reachable
      // only through the org-scoped revive lookup.
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValue(
        null,
      );
      mocks.installsRepo.findRevivableByGithubInstallationId.mockResolvedValue({
        id: 'existing-uuid',
        organizationId: 'o1',
        deletedAt: new Date('2026-05-10T00:00:00Z'),
      });
      mocks.client.listInstallationRepos.mockResolvedValue([
        makeRawRepo(10, 'acme/a', true),
      ]);

      await svc.handleCallback({
        state: 't',
        installationId: 42n,
        setupAction: 'install',
        sessionUserId: 'u1',
      });

      expect(
        mocks.installsRepo.findRevivableByGithubInstallationId,
      ).toHaveBeenCalledWith(42n, 'o1');
      expect(mocks.installsRepo.undelete).toHaveBeenCalledWith(
        'existing-uuid',
        expect.anything(),
      );
      // Must NOT create a duplicate row.
      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
      // Must still reconcile repos against the existing row id.
      expect(mocks.reposRepo.reconcileForInstallation).toHaveBeenCalledWith(
        'existing-uuid',
        [
          expect.objectContaining({
            githubRepoId: 10n,
            raw: expect.anything(),
          }),
        ],
        expect.anything(),
      );
    });
  });

  describe('listForOrg', () => {
    it('returns installations with their repos', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.listByOrganization.mockResolvedValue([
        {
          id: 'i1',
          githubInstallationId: 1n,
          githubAccountLogin: 'acme',
          githubAccountType: 'Organization',
          githubAccountAvatarUrl: null,
          suspendedAt: null,
          connectedByUserId: 'u1',
          createdAt: new Date('2026-01-01'),
        },
      ]);
      mocks.reposRepo.listByInstallation.mockResolvedValue([
        {
          id: 'r1',
          installationId: 'i1',
          githubRepoId: 9n,
          name: 'a',
          fullName: 'acme/a',
          private: true,
        },
      ]);

      const result = await svc.listForOrg('o1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('i1');
      expect(result[0].repositories).toHaveLength(1);
      expect(result[0].githubInstallationId).toBe('1');
      expect(result[0].repositories[0].githubRepoId).toBe('9');
    });
  });

  describe('disconnect', () => {
    it('soft-deletes repos then the installation inside a single tx', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue({
        id: 'inst-uuid',
        githubInstallationId: 42n,
      });

      await svc.disconnect('o1', 'inst-uuid');

      expect(mocks.client.deleteInstallation).toHaveBeenCalledWith(42n);
      expect(mocks.reposRepo.softDeleteAllForInstallation).toHaveBeenCalledWith(
        'inst-uuid',
        expect.anything(),
      );
      expect(mocks.installsRepo.softDelete).toHaveBeenCalledWith(
        'inst-uuid',
        expect.anything(),
      );
      // Same tx for both DB writes
      const reposTx =
        mocks.reposRepo.softDeleteAllForInstallation.mock.calls[0][1];
      const installsTx = mocks.installsRepo.softDelete.mock.calls[0][1];
      expect(reposTx).toBe(installsTx);
    });

    it('still soft-deletes locally when GitHub-side delete fails', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue({
        id: 'inst-uuid',
        githubInstallationId: 42n,
      });
      mocks.client.deleteInstallation.mockRejectedValue(new Error('boom'));

      await svc.disconnect('o1', 'inst-uuid');

      expect(mocks.installsRepo.softDelete).toHaveBeenCalled();
    });

    it('404s if the installation is unknown or already disconnected', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue(null);

      await expect(svc.disconnect('o1', 'inst-uuid')).rejects.toMatchObject({
        code: 'GITHUB_INSTALLATION_NOT_FOUND',
      });
    });
  });

  describe('sync', () => {
    it('404s when installation is not in the org', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue(null);

      await expect(svc.sync('o1', 'inst-1')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('replaces the repo set and returns the updated view', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue({
        id: 'inst-1',
        githubInstallationId: 5n,
        organizationId: 'o1',
        githubAccountLogin: 'acme',
        githubAccountType: 'Organization',
        githubAccountAvatarUrl: null,
        suspendedAt: null,
        connectedByUserId: 'u1',
        createdAt: new Date(),
      });
      mocks.client.listInstallationRepos.mockResolvedValue([
        makeRawRepo(10, 'acme/a', true),
      ]);
      mocks.reposRepo.listByInstallation.mockResolvedValue([
        {
          id: 'r1',
          installationId: 'inst-1',
          githubRepoId: 10n,
          name: 'a',
          fullName: 'acme/a',
          private: true,
        },
      ]);

      const view = await svc.sync('o1', 'inst-1');
      expect(mocks.reposRepo.reconcileForInstallation).toHaveBeenCalledWith(
        'inst-1',
        [
          expect.objectContaining({
            githubRepoId: 10n,
            fullName: 'acme/a',
            raw: expect.anything(),
          }),
        ],
      );
      expect(view.repositories).toHaveLength(1);
    });
  });

  describe('collaborator sync job enqueue', () => {
    it('enqueues trigger:connected for newly connected repos and trigger:disconnected for removed repos after handleCallback', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValueOnce({
        orgId: 'o1',
        userId: 'u1',
      });
      mocks.installsRepo.findActiveByGithubInstallationId.mockResolvedValueOnce(
        {
          id: 'i1',
          organizationId: 'o1',
          deletedAt: null,
        },
      );
      // Before: r-existing and r-gone are active
      mocks.reposRepo.listByInstallation.mockResolvedValueOnce([
        { id: 'r-existing' },
        { id: 'r-gone' },
      ]);
      mocks.client.listInstallationRepos.mockResolvedValueOnce([
        {
          githubRepoId: '1',
          name: 'a',
          fullName: 'org/a',
          private: false,
          raw: {},
        },
      ]);
      // After: r-existing remains, r-new appears, r-gone vanishes
      mocks.reposRepo.listByInstallation.mockResolvedValueOnce([
        { id: 'r-existing' },
        { id: 'r-new' },
      ]);

      await svc.handleCallback({
        installationId: 99n,
        state: 'tok',
        setupAction: 'install',
        sessionUserId: 'u1',
      });

      expect(mocks.temporal.start).toHaveBeenCalledWith(
        WORKFLOW.syncRepoCollaborators,
        expect.objectContaining({
          args: [
            {
              repositoryId: 'r-new',
              trigger: 'connected',
              organizationId: 'o1',
            },
          ],
        }),
      );
      expect(mocks.temporal.start).toHaveBeenCalledWith(
        WORKFLOW.syncRepoCollaborators,
        expect.objectContaining({
          args: [
            {
              repositoryId: 'r-gone',
              trigger: 'disconnected',
              organizationId: 'o1',
            },
          ],
        }),
      );
      expect(mocks.temporal.start).not.toHaveBeenCalledWith(
        WORKFLOW.syncRepoCollaborators,
        expect.objectContaining({
          args: [
            expect.objectContaining({
              repositoryId: 'r-existing',
              trigger: 'connected',
            }),
          ],
        }),
      );

      // Connecting must NOT start commit ingestion: the new repo has no branch
      // yet, and choosing one is what starts the scan.
      expect(mocks.temporal.startDeduped).not.toHaveBeenCalled();
    });

    it('enqueues the diff produced by sync()', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValueOnce({
        id: 'i1',
        githubInstallationId: 99n,
        organizationId: 'o1',
        githubAccountLogin: 'acme',
        githubAccountType: 'Organization',
        githubAccountAvatarUrl: null,
        suspendedAt: null,
        connectedByUserId: 'u1',
        createdAt: new Date(),
        deletedAt: null,
      });
      const repoA = {
        id: 'r-a',
        githubRepoId: 10n,
        name: 'a',
        fullName: 'org/a',
        private: false,
      };
      const repoB = {
        id: 'r-b',
        githubRepoId: 11n,
        name: 'b',
        fullName: 'org/b',
        private: false,
      };
      mocks.reposRepo.listByInstallation
        .mockResolvedValueOnce([repoA])
        .mockResolvedValueOnce([repoA, repoB]);
      mocks.client.listInstallationRepos.mockResolvedValueOnce([
        {
          githubRepoId: '1',
          name: 'b',
          fullName: 'org/b',
          private: false,
          raw: {},
        },
      ]);

      await svc.sync('o1', 'i1');

      expect(mocks.temporal.start).toHaveBeenCalledWith(
        WORKFLOW.syncRepoCollaborators,
        expect.objectContaining({
          args: [
            {
              repositoryId: 'r-b',
              trigger: 'connected',
              organizationId: 'o1',
            },
          ],
        }),
      );

      // Same for sync(): it runs with no user present, so it can never choose a
      // branch and must never start ingestion.
      expect(mocks.temporal.startDeduped).not.toHaveBeenCalled();
    });

    it('enqueues trigger:disconnected for every repo of an installation being disconnected', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValueOnce({
        id: 'i1',
        githubInstallationId: 99n,
        organizationId: 'o1',
        deletedAt: null,
      });
      mocks.reposRepo.listByInstallation.mockResolvedValueOnce([
        { id: 'r-a' },
        { id: 'r-b' },
      ]);
      mocks.client.deleteInstallation.mockResolvedValueOnce(undefined);

      await svc.disconnect('o1', 'i1');

      expect(mocks.temporal.start).toHaveBeenCalledWith(
        WORKFLOW.syncRepoCollaborators,
        expect.objectContaining({
          args: [
            {
              repositoryId: 'r-a',
              trigger: 'disconnected',
              organizationId: 'o1',
            },
          ],
        }),
      );
      expect(mocks.temporal.start).toHaveBeenCalledWith(
        WORKFLOW.syncRepoCollaborators,
        expect.objectContaining({
          args: [
            {
              repositoryId: 'r-b',
              trigger: 'disconnected',
              organizationId: 'o1',
            },
          ],
        }),
      );
      expect(mocks.temporal.start).toHaveBeenCalledTimes(2);
    });
  });
});
