import type { GithubAppClient } from '../../github.client';
import type { GithubInstallationsRepository } from '../../repositories/installations.repository';
import type { GithubRepositoriesRepository } from '../../repositories/repositories.repository';
import type { RepositoryBranchesRepository } from '../../repositories/repository-branches.repository';
import type { CommitAnalysesRepository } from '../repositories/commit-analyses.repository';
import type { CommitsRepository } from '../repositories/commits.repository';
import type { CommitAnalyzerService } from '../services/commit-analyzer.service';
import type { CommitBackfillService } from '../services/commit-backfill.service';
import { AppError } from '../../../../common/errors';
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
      analyzeCommits: jest.fn(),
      commitsPerCall: 4,
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
          // Import semantics unless the caller asks otherwise — a job row
          // enqueued before the field existed resumes without it.
          landedNow: false,
        },
        expect.any(Function),
      );
      expect(result).toEqual({ inserted: 3 });
    });

    // Only `CommitAnalysisJobs.ingestNewCommits`' resume branch sets this, and
    // it is what stamps `landed_at` on commits that just arrived on the branch.
    it('forwards landedNow when the caller is watching commits arrive', async () => {
      const mocks = makeMocks();
      mocks.backfill.run.mockResolvedValueOnce({ inserted: 1 });
      const activities = makeActivities(mocks);

      await activities.backfillCommits({
        repositoryId: 'r1',
        branch: 'main',
        sinceISO: '2026-01-01T00:00:00Z',
        landedNow: true,
      });

      expect(mocks.backfill.run).toHaveBeenCalledWith(
        expect.objectContaining({ landedNow: true }),
        expect.any(Function),
      );
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

  describe('analyzeCommitBatch', () => {
    /** Two commits ready for the model, `c1`/`sha1` and `c2`/`sha2`. */
    const ready = (mocks: ReturnType<typeof makeMocks>) => {
      mocks.commits.findById.mockImplementation((id: string) =>
        Promise.resolve({
          id,
          sha: id === 'c1' ? 'sha1aaa' : 'sha2bbb',
          repositoryId: 'r1',
          authorName: 'A',
          authorEmail: 'a@b.c',
          message: `msg ${id}`,
        }),
      );
      mocks.analyses.findByCommitId.mockResolvedValue(null);
      mocks.repos.findById.mockResolvedValue({
        id: 'r1',
        fullName: 'acme/web',
        installationId: 'i1',
      });
      mocks.installs.findById.mockResolvedValue({
        id: 'i1',
        githubInstallationId: 42,
      });
      mocks.client.getCommit.mockResolvedValue({
        files: [
          { path: 'src/a.ts', additions: 3, deletions: 1, patch: '@@ @@' },
        ],
      });
    };

    const analyzed = (summary: string) => ({
      status: 'analyzed' as const,
      commitType: 'feature' as const,
      summary,
      changes: ['did a thing'],
      model: 'haiku',
      promptTokens: 100,
      completionTokens: 50,
      diffCharsSent: 5,
      diffWasTruncated: false,
      rawOutput: {
        commit_type: 'feature' as const,
        summary,
        changes: ['did a thing'],
      },
    });

    it('writes one row per commit from a single call', async () => {
      const mocks = makeMocks();
      ready(mocks);
      mocks.analyzer.analyzeCommits.mockResolvedValueOnce(
        new Map([
          ['sha1aaa', analyzed('first')],
          ['sha2bbb', analyzed('second')],
        ]),
      );
      const activities = makeActivities(mocks);

      await activities.analyzeCommitBatch({ commitIds: ['c1', 'c2'] });

      expect(mocks.analyzer.analyzeCommits).toHaveBeenCalledTimes(1);
      expect(mocks.analyzer.analyzeCommit).not.toHaveBeenCalled();
      expect(mocks.analyses.insert).toHaveBeenCalledTimes(2);
      expect(mocks.analyses.insert.mock.calls.map(([r]) => r.summary)).toEqual([
        'first',
        'second',
      ]);
    });

    // The map's contract: absent means unanswered, and an unanswered commit is
    // analysed alone rather than left without a row.
    it('re-analyses a commit the batch left out, alone', async () => {
      const mocks = makeMocks();
      ready(mocks);
      mocks.analyzer.analyzeCommits.mockResolvedValueOnce(
        new Map([['sha1aaa', analyzed('first')]]),
      );
      mocks.analyzer.analyzeCommit.mockResolvedValueOnce(analyzed('alone'));
      const activities = makeActivities(mocks);

      await activities.analyzeCommitBatch({ commitIds: ['c1', 'c2'] });

      expect(mocks.analyzer.analyzeCommit).toHaveBeenCalledTimes(1);
      expect(mocks.analyses.insert.mock.calls.map(([r]) => r.summary)).toEqual([
        'first',
        'alone',
      ]);
    });

    // A malformed *batch* answer is about the batch: the same commits usually
    // parse one at a time, so they are retried singly straight away.
    it('falls back to single calls when the batch answer was malformed', async () => {
      const mocks = makeMocks();
      ready(mocks);
      mocks.analyzer.analyzeCommits.mockRejectedValueOnce(
        AppError.OPENAI_RESPONSE_INVALID({ reason: 'no analyses key' }),
      );
      mocks.analyzer.analyzeCommit.mockResolvedValue(analyzed('alone'));
      const activities = makeActivities(mocks);

      await activities.analyzeCommitBatch({ commitIds: ['c1', 'c2'] });

      expect(mocks.analyzer.analyzeCommit).toHaveBeenCalledTimes(2);
      expect(mocks.analyses.insert).toHaveBeenCalledTimes(2);
    });

    // A transport failure is about the provider. Four more calls into a
    // throttled CLI would time out the same way at 120 s each, so the commits
    // are recorded failed and the job's retry profile decides.
    it('records every commit failed and rethrows on a transport failure', async () => {
      const mocks = makeMocks();
      ready(mocks);
      mocks.analyzer.analyzeCommits.mockRejectedValueOnce(
        AppError.OPENAI_API_FAILED({ reason: 'timed out after 120s' }),
      );
      const activities = makeActivities(mocks);

      await expect(
        activities.analyzeCommitBatch({ commitIds: ['c1', 'c2'] }),
      ).rejects.toMatchObject({ code: 'OPENAI_API_FAILED' });

      expect(mocks.analyzer.analyzeCommit).not.toHaveBeenCalled();
      expect(mocks.analyses.insert.mock.calls.map(([r]) => r.status)).toEqual([
        'failed',
        'failed',
      ]);
    });

    it('takes the single path for a chunk of one', async () => {
      const mocks = makeMocks();
      ready(mocks);
      mocks.analyzer.analyzeCommit.mockResolvedValueOnce(analyzed('only'));
      const activities = makeActivities(mocks);

      await activities.analyzeCommitBatch({ commitIds: ['c1'] });

      expect(mocks.analyzer.analyzeCommits).not.toHaveBeenCalled();
      expect(mocks.analyzer.analyzeCommit).toHaveBeenCalledTimes(1);
    });
  });
});
