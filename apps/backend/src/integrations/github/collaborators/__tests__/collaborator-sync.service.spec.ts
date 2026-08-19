import { CollaboratorSyncService } from '../services/collaborator-sync.service';

function makeMocks() {
  const collaboratorsRepo = {
    upsertByGithubUserId: jest.fn(async (input: any) => ({
      id: `col-${input.githubUserId}`,
      githubUserId: input.githubUserId,
      login: input.login,
    })),
  } as any;

  const repoCollabRepo = {
    upsertByRepoCollaborator: jest.fn(async () => undefined),
    softDeleteAllForRepo: jest.fn(async () => 0),
    softDeleteMissingForRepo: jest.fn(async () => 0),
  } as any;

  const reposRepo = {
    findByIdIncludingDeleted: jest.fn(async () => null as any),
  } as any;

  const installsRepo = {
    findByIdIncludingDeleted: jest.fn(async () => null as any),
  } as any;

  const client = {
    listRepoCollaborators: jest.fn(async () => [] as any[]),
  } as any;

  const db = {
    transaction: jest.fn(() => ({
      execute: (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true }),
    })),
  } as any;

  return {
    collaboratorsRepo,
    repoCollabRepo,
    reposRepo,
    installsRepo,
    client,
    db,
  };
}

function makeService(overrides: Partial<ReturnType<typeof makeMocks>> = {}) {
  const m = { ...makeMocks(), ...overrides };
  return {
    svc: new CollaboratorSyncService(
      m.collaboratorsRepo,
      m.repoCollabRepo,
      m.reposRepo,
      m.installsRepo,
      m.client,
      m.db,
    ),
    mocks: m,
  };
}

describe('CollaboratorSyncService', () => {
  describe('when the repo is not found', () => {
    it('does nothing', async () => {
      const { svc, mocks } = makeService();
      mocks.reposRepo.findByIdIncludingDeleted.mockResolvedValueOnce(null);

      await svc.syncRepo('r1', 'connected');

      expect(mocks.client.listRepoCollaborators).not.toHaveBeenCalled();
      expect(mocks.repoCollabRepo.softDeleteAllForRepo).not.toHaveBeenCalled();
    });
  });

  describe('when trigger is disconnected', () => {
    it('soft-deletes all join rows and skips the API call', async () => {
      const { svc, mocks } = makeService();
      mocks.reposRepo.findByIdIncludingDeleted.mockResolvedValueOnce({
        id: 'r1',
        installationId: 'i1',
        fullName: 'acme/api',
        deletedAt: null,
      });
      mocks.repoCollabRepo.softDeleteAllForRepo.mockResolvedValueOnce(3);

      await svc.syncRepo('r1', 'disconnected');

      expect(mocks.repoCollabRepo.softDeleteAllForRepo).toHaveBeenCalledWith(
        'r1',
      );
      expect(mocks.client.listRepoCollaborators).not.toHaveBeenCalled();
    });
  });

  describe('when the repository is already soft-deleted', () => {
    it('short-circuits to soft-delete regardless of the trigger', async () => {
      const { svc, mocks } = makeService();
      mocks.reposRepo.findByIdIncludingDeleted.mockResolvedValueOnce({
        id: 'r1',
        installationId: 'i1',
        fullName: 'acme/api',
        deletedAt: new Date('2026-05-26T00:00:00Z'),
      });

      await svc.syncRepo('r1', 'manual');

      expect(mocks.repoCollabRepo.softDeleteAllForRepo).toHaveBeenCalledWith(
        'r1',
      );
      expect(mocks.client.listRepoCollaborators).not.toHaveBeenCalled();
    });
  });

  describe('when the installation is missing', () => {
    it('short-circuits to soft-delete', async () => {
      const { svc, mocks } = makeService();
      mocks.reposRepo.findByIdIncludingDeleted.mockResolvedValueOnce({
        id: 'r1',
        installationId: 'i1',
        fullName: 'acme/api',
        deletedAt: null,
      });
      mocks.installsRepo.findByIdIncludingDeleted.mockResolvedValueOnce(null);

      await svc.syncRepo('r1', 'connected');

      expect(mocks.repoCollabRepo.softDeleteAllForRepo).toHaveBeenCalledWith(
        'r1',
      );
      expect(mocks.client.listRepoCollaborators).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('upserts each collaborator and soft-deletes the missing set', async () => {
      const { svc, mocks } = makeService();
      mocks.reposRepo.findByIdIncludingDeleted.mockResolvedValueOnce({
        id: 'r1',
        installationId: 'i1',
        fullName: 'acme/api',
        deletedAt: null,
      });
      mocks.installsRepo.findByIdIncludingDeleted.mockResolvedValueOnce({
        id: 'i1',
        githubInstallationId: 99n,
        deletedAt: null,
      });
      mocks.client.listRepoCollaborators.mockResolvedValueOnce([
        {
          id: 1,
          login: 'alice',
          node_id: 'n1',
          avatar_url: 'a1',
          html_url: 'h1',
          type: 'User',
          site_admin: false,
          role_name: 'admin',
          permissions: {
            admin: true,
            maintain: true,
            push: true,
            triage: true,
            pull: true,
          },
        },
        {
          id: 2,
          login: 'bob',
          node_id: 'n2',
          avatar_url: null,
          html_url: 'h2',
          type: 'User',
          site_admin: false,
          role_name: 'write',
          permissions: {
            admin: false,
            maintain: false,
            push: true,
            triage: true,
            pull: true,
          },
        },
      ]);
      mocks.repoCollabRepo.softDeleteMissingForRepo.mockResolvedValueOnce(1);

      await svc.syncRepo('r1', 'connected');

      expect(mocks.client.listRepoCollaborators).toHaveBeenCalledWith(
        99n,
        'acme',
        'api',
      );
      expect(
        mocks.collaboratorsRepo.upsertByGithubUserId,
      ).toHaveBeenCalledTimes(2);
      expect(mocks.collaboratorsRepo.upsertByGithubUserId).toHaveBeenCalledWith(
        expect.objectContaining({ githubUserId: 1n, login: 'alice' }),
        { __tx: true },
      );
      expect(
        mocks.repoCollabRepo.upsertByRepoCollaborator,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryId: 'r1',
          collaboratorId: 'col-1',
          roleName: 'admin',
          permissionAdmin: true,
        }),
        { __tx: true },
      );
      expect(
        mocks.repoCollabRepo.softDeleteMissingForRepo,
      ).toHaveBeenCalledWith('r1', ['col-1', 'col-2'], { __tx: true });
    });
  });

  describe('when GitHub returns 404', () => {
    it('soft-deletes all join rows and does not throw', async () => {
      const { svc, mocks } = makeService();
      mocks.reposRepo.findByIdIncludingDeleted.mockResolvedValueOnce({
        id: 'r1',
        installationId: 'i1',
        fullName: 'acme/api',
        deletedAt: null,
      });
      mocks.installsRepo.findByIdIncludingDeleted.mockResolvedValueOnce({
        id: 'i1',
        githubInstallationId: 99n,
        deletedAt: null,
      });
      const err: any = new Error('Not Found');
      err.status = 404;
      mocks.client.listRepoCollaborators.mockRejectedValueOnce(err);

      await svc.syncRepo('r1', 'connected');

      expect(mocks.repoCollabRepo.softDeleteAllForRepo).toHaveBeenCalledWith(
        'r1',
      );
    });
  });

  describe('when GitHub returns 403', () => {
    const arrange = (mocks: ReturnType<typeof makeService>['mocks']) => {
      mocks.reposRepo.findByIdIncludingDeleted.mockResolvedValueOnce({
        id: 'r1',
        installationId: 'i1',
        fullName: 'acme/api',
        deletedAt: null,
      });
      mocks.installsRepo.findByIdIncludingDeleted.mockResolvedValueOnce({
        id: 'i1',
        githubInstallationId: 99n,
        deletedAt: null,
      });
    };

    it('skips without throwing when the token cannot see the access list', async () => {
      const { svc, mocks } = makeService();
      arrange(mocks);
      const err: any = new Error(
        'Resource not accessible by personal access token',
      );
      err.status = 403;
      err.response = { headers: { 'x-ratelimit-remaining': '4998' } };
      mocks.client.listRepoCollaborators.mockRejectedValueOnce(err);

      await expect(svc.syncRepo('r1', 'connected')).resolves.toBeUndefined();

      // Not "gone" — a repo outside a narrowed PAT's set keeps what it had.
      expect(mocks.repoCollabRepo.softDeleteAllForRepo).not.toHaveBeenCalled();
    });

    it('rethrows a rate-limit 403 so the job retries', async () => {
      const { svc, mocks } = makeService();
      arrange(mocks);
      const err: any = new Error('API rate limit exceeded');
      err.status = 403;
      err.response = { headers: { 'x-ratelimit-remaining': '0' } };
      mocks.client.listRepoCollaborators.mockRejectedValueOnce(err);

      await expect(svc.syncRepo('r1', 'connected')).rejects.toThrow();
    });
  });
});
