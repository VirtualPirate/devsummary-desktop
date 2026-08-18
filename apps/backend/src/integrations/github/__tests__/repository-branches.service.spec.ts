import { JOB } from '../../../jobs';
import { RepositoryBranchesService } from '../services/repository-branches.service';

function makeMocks() {
  const repos = {
    findByIdScopedToOrg: jest.fn(),
  } as any;

  const trackedBranches = {
    listByRepository: jest.fn(async () => [] as string[]),
    listByRepositories: jest.fn(async () => new Map<string, string[]>()),
    setBranchOnce: jest.fn(async (_repositoryId: string, branch: string) => ({
      locked: false,
      added: branch,
    })),
  } as any;

  const installs = {
    findById: jest.fn(async () => ({
      id: 'i1',
      githubInstallationId: 99n,
      organizationId: 'o1',
    })),
  } as any;

  const client = {
    listBranches: jest.fn(),
  } as any;

  const queue = {
    enqueue: jest.fn(
      async (_type: string, _args: unknown, opts: { id: string }) => opts.id,
    ),
  } as any;

  return { repos, installs, client, queue, trackedBranches };
}

function makeService(overrides: Partial<ReturnType<typeof makeMocks>> = {}) {
  const mocks = { ...makeMocks(), ...overrides };
  return {
    svc: new RepositoryBranchesService(
      mocks.repos,
      mocks.installs,
      mocks.client,
      mocks.queue,
      mocks.trackedBranches,
    ),
    mocks,
  };
}

const repoRow = (id: string) => ({
  id,
  installationId: 'i1',
  githubRepoId: 10n,
  name: id,
  fullName: `org/${id}`,
  private: true,
  raw: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});

describe('RepositoryBranchesService', () => {
  describe('listBranches', () => {
    it('serializes branches and the default from the GitHub client', async () => {
      const { svc, mocks } = makeService();
      mocks.repos.findByIdScopedToOrg.mockResolvedValueOnce(repoRow('r1'));
      mocks.client.listBranches.mockResolvedValueOnce({
        branches: [
          {
            name: 'develop',
            isDefault: true,
            lastCommitAt: new Date('2026-08-12T09:14:00.000Z'),
          },
          { name: 'main', isDefault: false, lastCommitAt: null },
        ],
        defaultBranch: 'develop',
        truncated: false,
      });

      const out = await svc.listBranches('o1', 'r1');

      expect(mocks.client.listBranches).toHaveBeenCalledWith(99n, 'org/r1');
      expect(out).toEqual({
        branches: [
          {
            name: 'develop',
            isDefault: true,
            lastCommitAt: '2026-08-12T09:14:00.000Z',
          },
          { name: 'main', isDefault: false, lastCommitAt: null },
        ],
        defaultBranch: 'develop',
        truncated: false,
      });
    });

    it('rejects a repository outside the caller org', async () => {
      const { svc, mocks } = makeService();
      mocks.repos.findByIdScopedToOrg.mockResolvedValueOnce(null);

      await expect(svc.listBranches('o1', 'r-other')).rejects.toMatchObject({
        code: 'GITHUB_REPOSITORY_NOT_FOUND',
      });
      expect(mocks.client.listBranches).not.toHaveBeenCalled();
    });
  });

  describe('setBranches', () => {
    it('sets one branch per repository and starts one scan each', async () => {
      const { svc, mocks } = makeService();
      mocks.repos.findByIdScopedToOrg
        .mockResolvedValueOnce(repoRow('r1'))
        .mockResolvedValueOnce(repoRow('r2'));

      const out = await svc.setBranches('o1', {
        lookbackDays: 90,
        selections: [
          { repositoryId: 'r1', branch: 'develop' },
          { repositoryId: 'r2', branch: 'release/2026.08' },
        ],
      });

      expect(mocks.trackedBranches.setBranchOnce).toHaveBeenNthCalledWith(
        1,
        'r1',
        'develop',
      );
      expect(mocks.queue.enqueue).toHaveBeenCalledWith(
        JOB.scanRepository,
        {
          repositoryId: 'r1',
          branch: 'develop',
          lookbackDays: 90,
          organizationId: 'o1',
        },
        expect.objectContaining({
          id: 'scan:r1:develop',
          phase: 'fetching',
          organizationId: 'o1',
        }),
      );
      expect(out).toEqual({
        jobIds: ['scan:r1:develop', 'scan:r2:release/2026.08'],
        started: 2,
      });
    });

    it('refuses a repository whose branch is already set', async () => {
      const { svc, mocks } = makeService();
      mocks.repos.findByIdScopedToOrg.mockResolvedValueOnce(repoRow('r1'));
      mocks.trackedBranches.listByRepository.mockResolvedValueOnce(['main']);

      await expect(
        svc.setBranches('o1', {
          lookbackDays: 90,
          selections: [{ repositoryId: 'r1', branch: 'develop' }],
        }),
      ).rejects.toMatchObject({
        code: 'GITHUB_REPOSITORY_BRANCHES_LOCKED',
        details: { branches: ['main'] },
      });
      expect(mocks.trackedBranches.setBranchOnce).not.toHaveBeenCalled();
      expect(mocks.queue.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a repository the write path finds already locked (concurrent set)', async () => {
      const { svc, mocks } = makeService();
      mocks.repos.findByIdScopedToOrg.mockResolvedValueOnce(repoRow('r1'));
      // Pre-flight sees nothing; a concurrent request wins the race.
      mocks.trackedBranches.setBranchOnce.mockResolvedValueOnce({
        locked: true,
        existing: 'main',
      });

      await expect(
        svc.setBranches('o1', {
          lookbackDays: 90,
          selections: [{ repositoryId: 'r1', branch: 'develop' }],
        }),
      ).rejects.toMatchObject({ code: 'GITHUB_REPOSITORY_BRANCHES_LOCKED' });
      expect(mocks.queue.enqueue).not.toHaveBeenCalled();
    });

    it('writes nothing when any selection is outside the caller org', async () => {
      const { svc, mocks } = makeService();
      mocks.repos.findByIdScopedToOrg
        .mockResolvedValueOnce(repoRow('r1'))
        .mockResolvedValueOnce(null);

      await expect(
        svc.setBranches('o1', {
          lookbackDays: 90,
          selections: [
            { repositoryId: 'r1', branch: 'main' },
            { repositoryId: 'r-other', branch: 'main' },
          ],
        }),
      ).rejects.toMatchObject({ code: 'GITHUB_REPOSITORY_NOT_FOUND' });

      // Ownership is validated for the whole batch before the first write, so a
      // bad id cannot leave half the repositories configured and scanning.
      expect(mocks.trackedBranches.setBranchOnce).not.toHaveBeenCalled();
      expect(mocks.queue.enqueue).not.toHaveBeenCalled();
    });

    it('rejects a duplicated repository instead of racing two scans', async () => {
      const { svc, mocks } = makeService();
      mocks.repos.findByIdScopedToOrg.mockResolvedValue(repoRow('r1'));

      await expect(
        svc.setBranches('o1', {
          lookbackDays: 30,
          selections: [
            { repositoryId: 'r1', branch: 'main' },
            { repositoryId: 'r1', branch: 'develop' },
          ],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(mocks.trackedBranches.setBranchOnce).not.toHaveBeenCalled();
    });
  });
});
