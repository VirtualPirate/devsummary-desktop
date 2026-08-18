import { GithubCollaboratorsController } from '../controllers/collaborators.controller';
import { JOB } from '../../../../jobs';

function makeMocks() {
  return {
    repoCollabRepo: {
      findActiveByRepoId: jest.fn(async () => []),
    } as any,
    reposRepo: {
      findByIdScopedToOrg: jest.fn(async () => null),
    } as any,
    queue: { enqueue: jest.fn(async () => 'job-id') } as any,
  };
}

function makeCtrl(overrides: Partial<ReturnType<typeof makeMocks>> = {}) {
  const m = { ...makeMocks(), ...overrides };
  return {
    ctrl: new GithubCollaboratorsController(
      m.repoCollabRepo,
      m.reposRepo,
      m.queue,
    ),
    mocks: m,
  };
}

const membership = {
  organizationId: 'o1',
  userId: 'u1',
  role: 'admin' as const,
};

describe('GithubCollaboratorsController', () => {
  describe('list', () => {
    it('returns rows for an org-owned repo', async () => {
      const { ctrl, mocks } = makeCtrl();
      mocks.reposRepo.findByIdScopedToOrg.mockResolvedValueOnce({ id: 'r1' });
      mocks.repoCollabRepo.findActiveByRepoId.mockResolvedValueOnce([
        {
          joinId: 'j1',
          collaboratorId: 'c1',
          githubUserId: 1n,
          login: 'alice',
          avatarUrl: 'a1',
          htmlUrl: 'h1',
          type: 'User',
          siteAdmin: false,
          roleName: 'admin',
          permissionAdmin: true,
          permissionMaintain: true,
          permissionPush: true,
          permissionTriage: true,
          permissionPull: true,
          updatedAt: new Date('2026-05-26T00:00:00Z'),
        },
      ]);

      const res = await ctrl.list({ id: 'r1' }, membership);

      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(res.data[0]).toMatchObject({
        login: 'alice',
        roleName: 'admin',
        githubUserId: '1',
        permissions: { admin: true, pull: true },
      });
    });

    it('throws when the repo does not belong to the org', async () => {
      const { ctrl, mocks } = makeCtrl();
      mocks.reposRepo.findByIdScopedToOrg.mockResolvedValueOnce(null);

      await expect(ctrl.list({ id: 'rX' }, membership)).rejects.toThrow();
    });
  });

  describe('sync', () => {
    it('enqueues the manual sync job and returns the job id', async () => {
      const { ctrl, mocks } = makeCtrl();
      mocks.reposRepo.findByIdScopedToOrg.mockResolvedValueOnce({ id: 'r1' });
      mocks.queue.enqueue.mockResolvedValueOnce('queued-id-xyz');

      const res = await ctrl.sync({ id: 'r1' }, membership);

      expect(mocks.queue.enqueue).toHaveBeenCalledWith(
        JOB.syncRepoCollaborators,
        {
          repositoryId: 'r1',
          trigger: 'manual',
          organizationId: 'o1',
        },
        expect.objectContaining({ phase: 'fetching', organizationId: 'o1' }),
      );
      expect(res.data).toEqual({ jobId: 'queued-id-xyz' });
      expect(res.success).toBe(true);
    });

    it('throws when the repo does not belong to the org', async () => {
      const { ctrl, mocks } = makeCtrl();
      mocks.reposRepo.findByIdScopedToOrg.mockResolvedValueOnce(null);

      await expect(ctrl.sync({ id: 'rX' }, membership)).rejects.toThrow();
    });
  });
});
