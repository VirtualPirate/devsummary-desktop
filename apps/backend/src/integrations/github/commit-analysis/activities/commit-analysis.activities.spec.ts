import type { GithubAppClient } from '../../github.client';
import type { GithubInstallationsRepository } from '../../repositories/installations.repository';
import type { GithubRepositoriesRepository } from '../../repositories/repositories.repository';
import type { RepositoryBranchesRepository } from '../../repositories/repository-branches.repository';
import type { CommitAnalysesRepository } from '../repositories/commit-analyses.repository';
import type { CommitsRepository } from '../repositories/commits.repository';
import type { CommitAnalyzerService } from '../services/commit-analyzer.service';
import type { CommitBackfillService } from '../services/commit-backfill.service';
import { CommitAnalysisActivities } from './commit-analysis.activities';

function makeMocks() {
  return {
    backfill: {
      run: jest.fn(),
      runFromLatest: jest.fn(),
    },
    commits: {
      findById: jest.fn(),
      findPageByRepositorySince: jest.fn(),
    },
    analyses: {
      findByCommitId: jest.fn(),
      insert: jest.fn(),
      upsertSkippedMerge: jest.fn(),
      deleteForCommitIds: jest.fn(),
      findCommitIdsWithAnalysis: jest.fn(),
    },
    repos: {
      findById: jest.fn(),
    },
    installs: {
      findById: jest.fn(),
    },
    client: {
      getCommit: jest.fn(),
    },
    analyzer: {
      analyzeCommit: jest.fn(),
    },
    trackedBranches: {
      listTrackedPage: jest.fn(),
    },
  };
}

function makeActivities(mocks: ReturnType<typeof makeMocks>) {
  return new CommitAnalysisActivities(
    mocks.backfill as unknown as CommitBackfillService,
    mocks.commits as unknown as CommitsRepository,
    mocks.analyses as unknown as CommitAnalysesRepository,
    mocks.repos as unknown as GithubRepositoriesRepository,
    mocks.installs as unknown as GithubInstallationsRepository,
    mocks.client as unknown as GithubAppClient,
    mocks.analyzer as unknown as CommitAnalyzerService,
    mocks.trackedBranches as unknown as RepositoryBranchesRepository,
  );
}

describe('CommitAnalysisActivities', () => {
  describe('planRepoAnalysis', () => {
    const at = (iso: string) => new Date(iso);
    const page = [
      { id: 'm1', parentCount: 2, authoredAt: at('2026-05-01T00:00:00Z') },
      { id: 'c1', parentCount: 1, authoredAt: at('2026-05-02T00:00:00Z') },
      { id: 'c2', parentCount: 1, authoredAt: at('2026-05-03T00:00:00Z') },
    ];

    it('skips merge commits and dedupes already-analyzed commits when force=false', async () => {
      const mocks = makeMocks();
      mocks.commits.findPageByRepositorySince.mockResolvedValueOnce(page);
      mocks.analyses.findCommitIdsWithAnalysis.mockResolvedValueOnce(
        new Set(['c1']),
      );
      const activities = makeActivities(mocks);

      const result = await activities.planRepoAnalysis({
        repositoryId: 'r1',
        sinceISO: '2026-05-01T00:00:00Z',
        force: false,
        limit: 500,
      });

      expect(mocks.analyses.upsertSkippedMerge).toHaveBeenCalledWith('m1');
      expect(result).toEqual({ commitIds: ['c2'], nextCursor: null });
    });

    it('deletes existing analyses and returns all candidate ids when force=true', async () => {
      const mocks = makeMocks();
      mocks.commits.findPageByRepositorySince.mockResolvedValueOnce(page);
      const activities = makeActivities(mocks);

      const result = await activities.planRepoAnalysis({
        repositoryId: 'r1',
        sinceISO: '2026-05-01T00:00:00Z',
        force: true,
        limit: 500,
      });

      expect(mocks.analyses.deleteForCommitIds).toHaveBeenCalledWith([
        'c1',
        'c2',
      ]);
      expect(result).toEqual({ commitIds: ['c1', 'c2'], nextCursor: null });
    });

    // A full page means there may be more; the cursor is the last row of the
    // page whether or not it was analysed, so the caller's loop always advances.
    it('returns a cursor on a full page and forwards it to the next query', async () => {
      const mocks = makeMocks();
      mocks.commits.findPageByRepositorySince.mockResolvedValueOnce(page);
      mocks.analyses.findCommitIdsWithAnalysis.mockResolvedValueOnce(new Set());
      const activities = makeActivities(mocks);

      const result = await activities.planRepoAnalysis({
        repositoryId: 'r1',
        sinceISO: '2026-05-01T00:00:00Z',
        force: false,
        limit: 3,
      });

      expect(result.nextCursor).toEqual({
        authoredAt: '2026-05-03T00:00:00.000Z',
        id: 'c2',
      });

      mocks.commits.findPageByRepositorySince.mockResolvedValueOnce([]);
      await activities.planRepoAnalysis({
        repositoryId: 'r1',
        sinceISO: '2026-05-01T00:00:00Z',
        force: false,
        limit: 3,
        after: result.nextCursor,
      });

      expect(mocks.commits.findPageByRepositorySince).toHaveBeenLastCalledWith({
        repositoryId: 'r1',
        sinceISO: '2026-05-01T00:00:00Z',
        limit: 3,
        after: { authoredAt: at('2026-05-03T00:00:00Z'), id: 'c2' },
      });
    });

    it('stops without querying analyses on an empty page', async () => {
      const mocks = makeMocks();
      mocks.commits.findPageByRepositorySince.mockResolvedValueOnce([]);
      const activities = makeActivities(mocks);

      const result = await activities.planRepoAnalysis({
        repositoryId: 'r1',
        sinceISO: '2026-05-01T00:00:00Z',
        force: false,
        limit: 500,
      });

      expect(result).toEqual({ commitIds: [], nextCursor: null });
      expect(mocks.analyses.findCommitIdsWithAnalysis).not.toHaveBeenCalled();
    });
  });

  describe('backfillFromLatest', () => {
    it('passes through the backfill service result and forwards input', async () => {
      const mocks = makeMocks();
      mocks.backfill.runFromLatest.mockResolvedValueOnce({
        inserted: 5,
        sinceISO: '2024-01-01T00:00:00Z',
      });
      const activities = makeActivities(mocks);

      const result = await activities.backfillFromLatest({
        repositoryId: 'r1',
        branch: 'main',
        lookbackDays: 30,
      });

      // Second argument is the progress callback; it now logs instead of
      // heartbeating, and calling it must still be harmless.
      expect(mocks.backfill.runFromLatest).toHaveBeenCalledWith(
        { repositoryId: 'r1', branch: 'main', lookbackDays: 30 },
        expect.any(Function),
      );
      const onProgress = mocks.backfill.runFromLatest.mock.calls[0][1] as (p: {
        inserted: number;
        pages: number;
      }) => void;
      expect(() => onProgress({ inserted: 1, pages: 1 })).not.toThrow();
      expect(result).toEqual({
        inserted: 5,
        sinceISO: '2024-01-01T00:00:00Z',
      });
    });
  });

  describe('backfillCommits', () => {
    it('passes through the backfill service result and forwards input', async () => {
      const mocks = makeMocks();
      mocks.backfill.run.mockResolvedValueOnce({ inserted: 3 });
      const activities = makeActivities(mocks);

      const result = await activities.backfillCommits({
        repositoryId: 'r1',
        branch: 'main',
        sinceISO: '2026-01-01T00:00:00Z',
      });

      expect(mocks.backfill.run).toHaveBeenCalledWith(
        {
          repositoryId: 'r1',
          branch: 'main',
          sinceISO: '2026-01-01T00:00:00Z',
        },
        expect.any(Function),
      );
      expect(result).toEqual({ inserted: 3 });
    });
  });

  describe('listSweepTargets', () => {
    const target = (repositoryId: string, branch = 'main') => ({
      repositoryId,
      branch,
      organizationId: 'org-1',
    });

    it('returns a cursor only when the page is full', async () => {
      const mocks = makeMocks();
      mocks.trackedBranches.listTrackedPage.mockResolvedValueOnce([
        target('r1'),
        target('r2'),
      ]);
      const activities = makeActivities(mocks);

      const result = await activities.listSweepTargets({ limit: 2 });

      expect(result.nextCursor).toEqual({
        repositoryId: 'r2',
        branch: 'main',
      });
      expect(result.targets).toHaveLength(2);
      expect(result.runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('ends the chain on a short page', async () => {
      const mocks = makeMocks();
      mocks.trackedBranches.listTrackedPage.mockResolvedValueOnce([
        target('r1'),
      ]);
      const activities = makeActivities(mocks);

      const result = await activities.listSweepTargets({ limit: 200 });

      expect(result.nextCursor).toBeNull();
    });

    it('ends the chain on an empty page', async () => {
      const mocks = makeMocks();
      mocks.trackedBranches.listTrackedPage.mockResolvedValueOnce([]);
      const activities = makeActivities(mocks);

      const result = await activities.listSweepTargets({ limit: 200 });

      expect(result).toMatchObject({ targets: [], nextCursor: null });
    });

    // The cursor is the pair, not the repository: a repository-only cursor would
    // skip a second branch sitting on the far side of a page boundary.
    it('passes the pair cursor straight through to the repository', async () => {
      const mocks = makeMocks();
      mocks.trackedBranches.listTrackedPage.mockResolvedValueOnce([]);
      const activities = makeActivities(mocks);
      const after = { repositoryId: 'r9', branch: 'develop' };

      await activities.listSweepTargets({ limit: 50, after });

      expect(mocks.trackedBranches.listTrackedPage).toHaveBeenCalledWith({
        limit: 50,
        after,
      });
    });
  });

  describe('analyzeCommit', () => {
    it('resolves without calling the analyzer when the commit is not found', async () => {
      const mocks = makeMocks();
      mocks.commits.findById.mockResolvedValueOnce(null);
      const activities = makeActivities(mocks);

      await activities.analyzeCommit({ commitId: 'c1' });

      expect(mocks.analyzer.analyzeCommit).not.toHaveBeenCalled();
      expect(mocks.analyses.insert).not.toHaveBeenCalled();
    });
  });
});
