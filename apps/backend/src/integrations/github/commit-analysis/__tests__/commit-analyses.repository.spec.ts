import { CommitAnalysesRepository } from '../repositories/commit-analyses.repository';

function makeRawExecDb() {
  const executeQuery = jest.fn(async () => ({ rows: [] }));
  const db = {
    getExecutor: () => ({
      transformQuery: (node: unknown) => node,
      compileQuery: () => ({ sql: '', parameters: [] }),
      executeQuery,
    }),
  };
  return { db, executeQuery };
}

describe('CommitAnalysesRepository', () => {
  it('instantiates with a db handle and exposes all methods', () => {
    const repo = new CommitAnalysesRepository({} as never);
    expect(typeof repo.findByCommitId).toBe('function');
    expect(typeof repo.findCommitIdsWithAnalysis).toBe('function');
    expect(typeof repo.upsertSkippedMerge).toBe('function');
    expect(typeof repo.deleteForCommitIds).toBe('function');
    expect(typeof repo.insert).toBe('function');
  });
});

/**
 * Records the size of every `IN` list the repository sends. One bind parameter
 * per id, against Postgres' 65535-per-statement cap, so a scan of a busy
 * repository has to be split across statements.
 */
function inListSpyDb(
  rowsFor: (batch: string[]) => Array<{ commitId: string }>,
) {
  const inListSizes: number[] = [];
  const chain = {
    select: () => chain,
    where: (_col: string, _op: string, batch: string[]) => {
      inListSizes.push(batch.length);
      lastBatch = batch;
      return chain;
    },
    execute: () => Promise.resolve(rowsFor(lastBatch)),
  };
  let lastBatch: string[] = [];
  const db = { selectFrom: () => chain, deleteFrom: () => chain };
  return { db, inListSizes };
}

describe('CommitAnalysesRepository id-list chunking', () => {
  const ids = Array.from({ length: 2500 }, (_, i) => `c${i}`);

  it('splits the analysed-id lookup and unions every batch', async () => {
    const { db, inListSizes } = inListSpyDb((batch) =>
      batch.map((commitId) => ({ commitId })),
    );

    const found = await new CommitAnalysesRepository(
      db as never,
    ).findCommitIdsWithAnalysis(ids);

    expect(inListSizes).toEqual([1000, 1000, 500]);
    expect(found.size).toBe(2500);
    expect(found.has('c0')).toBe(true);
    expect(found.has('c2499')).toBe(true);
  });

  it('splits the delete', async () => {
    const { db, inListSizes } = inListSpyDb(() => []);

    await new CommitAnalysesRepository(db as never).deleteForCommitIds(ids);

    expect(inListSizes).toEqual([1000, 1000, 500]);
  });
});

describe('CommitAnalysesRepository.zeroFillSkippedEmpty', () => {
  it('issues a single update', async () => {
    const chain: any = {};
    chain.set = jest.fn(() => chain);
    chain.where = jest.fn(() => chain);
    chain.execute = jest.fn().mockResolvedValue(undefined);
    const db = { updateTable: jest.fn(() => chain) };
    const repo = new CommitAnalysesRepository(db as never);
    await repo.zeroFillSkippedEmpty();
    expect(db.updateTable).toHaveBeenCalledTimes(1);
    expect(chain.set).toHaveBeenCalledWith({
      additions: 0,
      deletions: 0,
      updatedAt: expect.any(Date),
    });
    expect(chain.execute).toHaveBeenCalledTimes(1);
  });
});

describe('CommitAnalysesRepository.findRepositoryIdsMissingLocStats', () => {
  it('returns distinct repository ids needing backfill', async () => {
    const rows = [{ repositoryId: 'repo-1' }, { repositoryId: 'repo-2' }];
    const chain: any = {};
    chain.innerJoin = jest.fn(() => chain);
    chain.select = jest.fn(() => chain);
    chain.distinct = jest.fn(() => chain);
    chain.where = jest.fn(() => chain);
    chain.execute = jest.fn().mockResolvedValue(rows);
    const db = { selectFrom: jest.fn(() => chain) };
    const repo = new CommitAnalysesRepository(db as never);
    const result = await repo.findRepositoryIdsMissingLocStats(
      new Date('2025-06-10T00:00:00Z'),
    );
    expect(result).toEqual(['repo-1', 'repo-2']);
  });
});

describe('CommitAnalysesRepository.setLocStatsBySha', () => {
  it('short-circuits on an empty stats list without querying', async () => {
    const { db, executeQuery } = makeRawExecDb();
    const repo = new CommitAnalysesRepository(db as never);
    await repo.setLocStatsBySha('repo-1', []);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('issues a single bulk update for non-empty stats', async () => {
    const { db, executeQuery } = makeRawExecDb();
    const repo = new CommitAnalysesRepository(db as never);
    await repo.setLocStatsBySha('repo-1', [
      { sha: 'abc', additions: 3, deletions: 1 },
      { sha: 'def', additions: 0, deletions: 7 },
    ]);
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });
});

describe('CommitAnalysesRepository.sealLocStats', () => {
  it('issues a single sealing update', async () => {
    const { db, executeQuery } = makeRawExecDb();
    const repo = new CommitAnalysesRepository(db as never);
    await repo.sealLocStats('repo-1', new Date('2025-06-10T00:00:00Z'));
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });
});
