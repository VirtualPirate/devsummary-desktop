import { BriefCommitsRepository } from '../brief-commits.repository';

describe('BriefCommitsRepository.replaceForBrief', () => {
  /**
   * Records the rows of every insert statement and which handle it ran on. A
   * link row binds 3 of Postgres's 65535 bind parameters, so a large brief has
   * to be split — and once it is split, the delete and the inserts have to share
   * a transaction or a crash between batches leaves the brief half-linked.
   */
  function fakeDb() {
    const batches: unknown[][] = [];
    const deletedBriefIds: string[] = [];
    const tx = {
      deleteFrom: jest.fn(() => ({
        where: (_col: string, _op: string, briefId: string) => {
          deletedBriefIds.push(briefId);
          return { execute: () => Promise.resolve(undefined) };
        },
      })),
      insertInto: jest.fn(() => ({
        values: (rows: unknown[]) => {
          batches.push(rows);
          return { execute: () => Promise.resolve(undefined) };
        },
      })),
    };
    const db = {
      transaction: jest.fn(() => ({
        execute: (run: (exec: unknown) => Promise<void>) => run(tx),
      })),
      deleteFrom: jest.fn(),
      insertInto: jest.fn(),
    };
    return { db, tx, batches, deletedBriefIds };
  }

  it('deletes existing links then inserts the new ones, all on the transaction', async () => {
    const { db, tx, batches, deletedBriefIds } = fakeDb();
    const repo = new BriefCommitsRepository(db as never);
    await repo.replaceForBrief('b1', [
      { commitId: 'c1', sha: 'aaa' },
      { commitId: 'c2', sha: 'bbb' },
    ]);
    expect(deletedBriefIds).toEqual(['b1']);
    expect(batches).toEqual([
      [
        { briefId: 'b1', commitId: 'c1', sha: 'aaa' },
        { briefId: 'b1', commitId: 'c2', sha: 'bbb' },
      ],
    ]);
    expect(tx.deleteFrom).toHaveBeenCalledTimes(1);
    expect(db.deleteFrom).not.toHaveBeenCalled();
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it('deletes but does not insert when links is empty', async () => {
    const { db, tx, deletedBriefIds } = fakeDb();
    const repo = new BriefCommitsRepository(db as never);
    await repo.replaceForBrief('b1', []);
    expect(deletedBriefIds).toEqual(['b1']);
    expect(tx.insertInto).not.toHaveBeenCalled();
  });

  it('splits a large replace into statements under the bind-parameter cap', async () => {
    const { db, tx, batches } = fakeDb();
    const links = Array.from({ length: 2500 }, (_, i) => ({
      commitId: `c${i}`,
      sha: `sha${i}`,
    }));

    await new BriefCommitsRepository(db as never).replaceForBrief('b1', links);

    const sizes = batches.map((b) => b.length);
    expect(sizes).toEqual([1000, 1000, 500]);
    // 3 bound columns per link row, so every statement stays well under 65535.
    expect(Math.max(...sizes) * 3).toBeLessThan(65535);
    // One delete + three inserts, one transaction: no partially linked brief.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.deleteFrom).toHaveBeenCalledTimes(1);
    expect(tx.insertInto).toHaveBeenCalledTimes(3);
  });

  it('joins the caller transaction rather than opening its own', async () => {
    const outer = fakeDb();
    const caller = fakeDb();
    const repo = new BriefCommitsRepository(outer.db as never);

    await repo.replaceForBrief(
      'b1',
      [{ commitId: 'c1', sha: 'aaa' }],
      caller.tx as never,
    );

    expect(outer.db.transaction).not.toHaveBeenCalled();
    expect(caller.deletedBriefIds).toEqual(['b1']);
    expect(caller.batches).toHaveLength(1);
  });
});

describe('BriefCommitsRepository.listForBrief', () => {
  function makeDb(rows: unknown[]) {
    const chain = {
      leftJoin: jest.fn(),
      select: jest.fn(),
      where: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
      execute: jest.fn().mockResolvedValue(rows),
    };
    chain.leftJoin.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    return { selectFrom: jest.fn(() => chain) };
  }

  it('returns rows without cursor condition', async () => {
    const rows = [{ briefCommitId: 'bc1', sha: 'aaa', commitId: 'c1' }];
    const repo = new BriefCommitsRepository(makeDb(rows) as never);
    const result = await repo.listForBrief({ briefId: 'b1', limit: 10 });
    expect(result).toEqual(rows);
  });

  it('returns rows when a non-null cursor is provided', async () => {
    const rows = [{ briefCommitId: 'bc2', sha: 'bbb', commitId: 'c2' }];
    const repo = new BriefCommitsRepository(makeDb(rows) as never);
    const result = await repo.listForBrief({
      briefId: 'b1',
      limit: 10,
      cursorAuthoredAt: new Date('2026-05-20T00:00:00Z'),
      cursorId: 'bc1',
    });
    expect(result).toEqual(rows);
  });

  it('returns rows when a null-authoredAt cursor is provided', async () => {
    const rows = [{ briefCommitId: 'bc3', sha: 'ccc', commitId: null }];
    const repo = new BriefCommitsRepository(makeDb(rows) as never);
    const result = await repo.listForBrief({
      briefId: 'b1',
      limit: 10,
      cursorAuthoredAt: null,
      cursorId: 'bc2',
    });
    expect(result).toEqual(rows);
  });
});

describe('BriefCommitsRepository.countTypesForBriefs', () => {
  function makeDb(rows: unknown[]) {
    const chain = {
      leftJoin: jest.fn(),
      select: jest.fn(),
      where: jest.fn(),
      groupBy: jest.fn(),
      execute: jest.fn(() => Promise.resolve(rows)),
    };
    chain.leftJoin.mockReturnValue(chain);
    chain.select.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.groupBy.mockReturnValue(chain);
    return {
      db: { selectFrom: jest.fn(() => chain) },
      chain,
    };
  }

  it('returns grouped type counts for the requested briefs', async () => {
    const rows = [
      { briefId: 'b1', commitType: 'feature', count: 9 },
      { briefId: 'b1', commitType: 'fix', count: 7 },
      { briefId: 'b1', commitType: null, count: 3 },
      { briefId: 'b2', commitType: 'chore', count: 1 },
    ];
    const { db, chain } = makeDb(rows);
    const repo = new BriefCommitsRepository(db as never);
    const result = await repo.countTypesForBriefs(['b1', 'b2']);
    expect(result).toEqual(rows);
    expect(db.selectFrom).toHaveBeenCalledTimes(1);
    expect(chain.where).toHaveBeenCalledWith(
      'briefs.briefCommits.briefId',
      'in',
      ['b1', 'b2'],
    );
  });

  it('short-circuits to [] for an empty briefIds list without querying', async () => {
    const { db } = makeDb([]);
    const repo = new BriefCommitsRepository(db as never);
    const result = await repo.countTypesForBriefs([]);
    expect(result).toEqual([]);
    expect(db.selectFrom).not.toHaveBeenCalled();
  });
});
