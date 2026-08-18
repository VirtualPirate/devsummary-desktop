import type { GithubAppClient } from '../../github-app.client';
import type { GithubInstallationsRepository } from '../../repositories/installations.repository';
import type { GithubRepositoriesRepository } from '../../repositories/repositories.repository';
import type { CommitAnalysesRepository } from '../repositories/commit-analyses.repository';
import { LocStatsActivities } from './loc-stats.activities';

function makeMocks() {
  return {
    analyses: {
      zeroFillSkippedEmpty: jest.fn(),
      findRepositoryIdsMissingLocStats: jest.fn(),
      setLocStatsBySha: jest.fn(),
      sealLocStats: jest.fn(),
    },
    repos: {
      findById: jest.fn(),
    },
    installs: {
      findById: jest.fn(),
    },
    client: {
      listCommitLocStats: jest.fn(),
    },
  };
}

function makeActivities(mocks: ReturnType<typeof makeMocks>) {
  return new LocStatsActivities(
    mocks.analyses as unknown as CommitAnalysesRepository,
    mocks.repos as unknown as GithubRepositoriesRepository,
    mocks.installs as unknown as GithubInstallationsRepository,
    mocks.client as unknown as GithubAppClient,
  );
}

describe('LocStatsActivities', () => {
  describe('zeroFillAndFindMissing', () => {
    it('zero-fills skipped-empty rows then returns repository ids missing LOC stats', async () => {
      const mocks = makeMocks();
      mocks.analyses.zeroFillSkippedEmpty.mockResolvedValueOnce(undefined);
      mocks.analyses.findRepositoryIdsMissingLocStats.mockResolvedValueOnce([
        'r1',
        'r2',
      ]);
      const activities = makeActivities(mocks);

      const result = await activities.zeroFillAndFindMissing();

      expect(mocks.analyses.zeroFillSkippedEmpty).toHaveBeenCalledWith();
      expect(
        mocks.analyses.findRepositoryIdsMissingLocStats,
      ).toHaveBeenCalledWith(expect.any(Date));
      expect(result).toEqual({ repositoryIds: ['r1', 'r2'] });
    });
  });

  describe('pageRepo', () => {
    it('returns null nextCursor when repo is not found', async () => {
      const mocks = makeMocks();
      mocks.repos.findById.mockResolvedValueOnce(null);
      const activities = makeActivities(mocks);

      const result = await activities.pageRepo({
        repositoryId: 'r1',
        cursor: null,
      });

      expect(result).toEqual({ nextCursor: null });
      expect(mocks.installs.findById).not.toHaveBeenCalled();
    });

    it('returns null nextCursor when installation is not found', async () => {
      const mocks = makeMocks();
      mocks.repos.findById.mockResolvedValueOnce({
        id: 'r1',
        installationId: 'i1',
        fullName: 'o/r',
      });
      mocks.installs.findById.mockResolvedValueOnce(null);
      const activities = makeActivities(mocks);

      const result = await activities.pageRepo({
        repositoryId: 'r1',
        cursor: null,
      });

      expect(result).toEqual({ nextCursor: null });
      expect(mocks.client.listCommitLocStats).not.toHaveBeenCalled();
    });

    it('writes stats and returns the next cursor when history is not exhausted', async () => {
      const mocks = makeMocks();
      mocks.repos.findById.mockResolvedValueOnce({
        id: 'r1',
        installationId: 'i1',
        fullName: 'o/r',
      });
      mocks.installs.findById.mockResolvedValueOnce({
        githubInstallationId: 123,
      });
      mocks.client.listCommitLocStats.mockResolvedValue({
        stats: [{ sha: 'x', additions: 1, deletions: 2 }],
        nextCursor: 'c2',
      });
      const activities = makeActivities(mocks);

      const result = await activities.pageRepo({
        repositoryId: 'r1',
        cursor: null,
      });

      expect(mocks.analyses.setLocStatsBySha).toHaveBeenCalledWith('r1', [
        { sha: 'x', additions: 1, deletions: 2 },
      ]);
      expect(mocks.analyses.sealLocStats).not.toHaveBeenCalled();
      expect(result).toEqual({ nextCursor: 'c2' });
    });

    it('seals LOC stats and returns null nextCursor when history is exhausted', async () => {
      const mocks = makeMocks();
      mocks.repos.findById.mockResolvedValueOnce({
        id: 'r1',
        installationId: 'i1',
        fullName: 'o/r',
      });
      mocks.installs.findById.mockResolvedValueOnce({
        githubInstallationId: 123,
      });
      mocks.client.listCommitLocStats.mockResolvedValueOnce({
        stats: [],
        nextCursor: null,
      });
      const activities = makeActivities(mocks);

      const result = await activities.pageRepo({
        repositoryId: 'r1',
        cursor: null,
      });

      expect(mocks.analyses.setLocStatsBySha).not.toHaveBeenCalled();
      expect(mocks.analyses.sealLocStats).toHaveBeenCalledWith(
        'r1',
        expect.any(Date),
      );
      expect(result).toEqual({ nextCursor: null });
    });
  });
});
