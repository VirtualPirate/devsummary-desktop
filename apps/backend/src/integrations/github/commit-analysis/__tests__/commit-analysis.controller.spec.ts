import { CommitAnalysisController } from '../controllers/commit-analysis.controller';
import { JOB } from '../../../../jobs';

function makeController() {
  const reposRepo = {
    findByIdScopedToOrg: jest.fn(),
  } as any;
  const commitsRepo = {
    countByRepositorySince: jest.fn(async () => 7),
  } as any;
  const queue = {
    enqueue: jest.fn(async () => 'queued-id'),
  } as any;
  const trackedBranches = {
    listByRepository: jest.fn(async () => ['main']),
  } as any;

  return {
    controller: new CommitAnalysisController(
      reposRepo,
      commitsRepo,
      queue,
      trackedBranches,
    ),
    reposRepo,
    commitsRepo,
    queue,
    trackedBranches,
  };
}

const membership = { organizationId: 'org-1' } as any;

describe('CommitAnalysisController', () => {
  it('throws 404 when repo not found in org for backfill', async () => {
    const { controller, reposRepo } = makeController();
    reposRepo.findByIdScopedToOrg.mockResolvedValueOnce(null);
    await expect(
      controller.backfill(membership, { repoId: 'r1' }, { days: 30 }),
    ).rejects.toMatchObject({ code: 'GITHUB_REPOSITORY_NOT_FOUND' });
  });

  it('enqueues backfill with computed sinceISO and idempotency key', async () => {
    const { controller, reposRepo, queue } = makeController();
    reposRepo.findByIdScopedToOrg.mockResolvedValueOnce({ id: 'r1' });
    jest.useFakeTimers().setSystemTime(new Date('2026-05-16T12:00:00Z'));

    const res = await controller.backfill(
      membership,
      { repoId: 'r1' },
      { days: 30 },
    );

    expect(queue.enqueue).toHaveBeenCalledWith(
      JOB.backfillCommits,
      expect.objectContaining({
        repositoryId: 'r1',
        branch: 'main',
        sinceISO: '2026-04-16T12:00:00.000Z',
        organizationId: 'org-1',
      }),
      expect.objectContaining({ id: 'backfill:r1:main:2026-04-16' }),
    );
    expect(res.data.jobId).toBe('queued-id');
    jest.useRealTimers();
  });

  it('starts one backfill per tracked branch', async () => {
    const { controller, reposRepo, queue, trackedBranches } =
      makeController();
    reposRepo.findByIdScopedToOrg.mockResolvedValueOnce({ id: 'r1' });
    trackedBranches.listByRepository.mockResolvedValueOnce(['main', 'develop']);
    jest.useFakeTimers().setSystemTime(new Date('2026-05-16T12:00:00Z'));

    await controller.backfill(membership, { repoId: 'r1' }, { days: 30 });

    const ids = queue.enqueue.mock.calls.map(
      (c: unknown[]) => (c[2] as { id: string }).id,
    );
    expect(ids).toEqual([
      'backfill:r1:main:2026-04-16',
      'backfill:r1:develop:2026-04-16',
    ]);
    jest.useRealTimers();
  });

  it('refuses to pick a branch when the repository tracks none', async () => {
    const { controller, reposRepo, queue, trackedBranches } =
      makeController();
    reposRepo.findByIdScopedToOrg.mockResolvedValueOnce({ id: 'r1' });
    trackedBranches.listByRepository.mockResolvedValueOnce([]);

    await expect(
      controller.backfill(membership, { repoId: 'r1' }, { days: 30 }),
    ).rejects.toMatchObject({
      code: 'GITHUB_REPOSITORY_BRANCH_NOT_CONFIGURED',
    });
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues analyze with expectedCommitCount', async () => {
    const { controller, reposRepo, commitsRepo, queue } = makeController();
    reposRepo.findByIdScopedToOrg.mockResolvedValueOnce({ id: 'r1' });
    jest.useFakeTimers().setSystemTime(new Date('2026-05-16T12:00:00Z'));

    const res = await controller.analyze(
      membership,
      { repoId: 'r1' },
      { days: 7, force: true },
    );

    expect(commitsRepo.countByRepositorySince).toHaveBeenCalledWith(
      'r1',
      '2026-05-09T12:00:00.000Z',
    );
    expect(queue.enqueue).toHaveBeenCalledWith(
      JOB.analyzeRepo,
      expect.objectContaining({
        repositoryId: 'r1',
        sinceISO: '2026-05-09T12:00:00.000Z',
        force: true,
        organizationId: 'org-1',
      }),
      expect.objectContaining({ id: 'analyze:r1:2026-05-09:true' }),
    );
    expect(res.data.expectedCommitCount).toBe(7);
    jest.useRealTimers();
  });

  // The dedup key must follow the window, not the raw `days`: keying on the repo
  // id alone let a 90-day backfill be absorbed by a Running 7-day one via
  // USE_EXISTING, and the endpoint still answered 202.
  it('gives different backfill windows different dedup keys', async () => {
    const { controller, reposRepo, queue } = makeController();
    reposRepo.findByIdScopedToOrg.mockResolvedValue({ id: 'r1' });
    jest.useFakeTimers().setSystemTime(new Date('2026-05-16T12:00:00Z'));

    await controller.backfill(membership, { repoId: 'r1' }, { days: 7 });
    await controller.backfill(membership, { repoId: 'r1' }, { days: 90 });

    const ids = queue.enqueue.mock.calls.map(
      (c: unknown[]) => (c[2] as { id: string }).id,
    );
    expect(ids).toEqual([
      'backfill:r1:main:2026-05-09',
      'backfill:r1:main:2026-02-15',
    ]);
    jest.useRealTimers();
  });

  it('keeps the same dedup key for repeat requests inside the window bucket', async () => {
    const { controller, reposRepo, queue } = makeController();
    reposRepo.findByIdScopedToOrg.mockResolvedValue({ id: 'r1' });
    jest.useFakeTimers().setSystemTime(new Date('2026-05-16T12:00:00Z'));

    await controller.analyze(membership, { repoId: 'r1' }, { days: 7 });
    jest.setSystemTime(new Date('2026-05-16T13:00:00Z'));
    await controller.analyze(membership, { repoId: 'r1' }, { days: 7 });

    const ids = queue.enqueue.mock.calls.map(
      (c: unknown[]) => (c[2] as { id: string }).id,
    );
    expect(ids[0]).toBe(ids[1]);
    jest.useRealTimers();
  });
});
