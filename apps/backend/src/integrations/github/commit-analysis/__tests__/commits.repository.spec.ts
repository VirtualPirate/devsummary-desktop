import {
  BRIEF_SCOPE_PAGE_ROWS,
  CommitsRepository,
  type GithubCommitUpsertRow,
} from '../repositories/commits.repository';

/**
 * Records the row count of every insert statement. Postgres binds parameters as
 * int16, so a single statement may carry at most 65535 of them; a commit row
 * binds 15, which is why the repository must split large backfills.
 */
function fakeDb() {
  const batchSizes: number[] = [];
  const noop = () => ({
    columns: () => ({ doUpdateSet: noop, doNothing: noop }),
  });
  const db = {
    insertInto: () => ({
      values: (rows: unknown[]) => {
        batchSizes.push(rows.length);
        return {
          onConflict: (cb: (oc: unknown) => unknown) => {
            cb(noop());
            return {
              returning: () => ({
                execute: () =>
                  Promise.resolve(
                    rows.map((_, i) => ({ id: `id${i}`, sha: `sha${i}` })),
                  ),
              }),
              execute: () => Promise.resolve(undefined),
            };
          },
        };
      },
    }),
  };
  return { db, batchSizes };
}

const row = (sha: string) => ({ sha }) as unknown as GithubCommitUpsertRow;

type ScopeRow = Record<string, unknown>;
type Pred = (row: ScopeRow) => boolean;

const value = (v: unknown) => (v instanceof Date ? v.getTime() : v);
const col = (name: string) => name.replace('c.', '');

/**
 * Serves `findForBriefScope` from a fixed row set, honouring only what the
 * paging depends on: the `orderBy` pair and the keyset `where` callback. The
 * scalar filters (repository, period, soft delete) are left to the real
 * database — every row here already satisfies them.
 */
function fakeScopeDb(rows: ScopeRow[]) {
  const pageSizes: number[] = [];
  const eb = Object.assign(
    (name: string, op: string, val: unknown): Pred =>
      (r) => {
        const left = value(r[col(name)]);
        const right = value(val);
        return op === '='
          ? left === right
          : (left as number) < (right as number);
      },
    {
      or:
        (preds: Pred[]): Pred =>
        (r) =>
          preds.some((p) => p(r)),
      and:
        (preds: Pred[]): Pred =>
        (r) =>
          preds.every((p) => p(r)),
    },
  );

  const compare =
    (order: Array<[string, string]>) => (a: ScopeRow, b: ScopeRow) => {
      for (const [name, dir] of order) {
        const x = value(a[col(name)]) as number;
        const y = value(b[col(name)]) as number;
        if (x === y) continue;
        return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    };

  const build = (preds: Pred[], order: Array<[string, string]>) => {
    const self = {
      leftJoin: () => self,
      selectAll: () => self,
      select: () => self,
      where: (arg: unknown) =>
        typeof arg === 'function'
          ? build([...preds, (arg as (e: typeof eb) => Pred)(eb)], order)
          : self,
      orderBy: (name: string, dir: string) =>
        build(preds, [...order, [name, dir] as [string, string]]),
      limit: (n: number) => ({
        execute: () => {
          const page = rows
            .filter((r) => preds.every((p) => p(r)))
            .sort(compare(order))
            .slice(0, n);
          pageSizes.push(page.length);
          return Promise.resolve(page);
        },
      }),
    };
    return self;
  };

  return { db: { selectFrom: () => build([], []) }, pageSizes };
}

const PAGE = BRIEF_SCOPE_PAGE_ROWS;
const TOTAL = PAGE * 2 + 7;
const BASE = Date.UTC(2026, 0, 1);
/** Five commits share one timestamp across the first page boundary — one push. */
const tied = (i: number) => (i >= PAGE - 2 && i <= PAGE + 2 ? PAGE - 2 : i);
/**
 * Ids descend as the index rises, so `authoredAt desc, id desc` — what the
 * query orders by — is exactly index order, ties included.
 */
const expected: ScopeRow[] = Array.from({ length: TOTAL }, (_, i) => ({
  id: `c${String(TOTAL - i).padStart(6, '0')}`,
  sha: `sha${i}`,
  authoredAt: new Date(BASE - tied(i) * 1000),
  aId: null,
}));

const scope = {
  repositoryIds: ['r1'],
  periodStart: new Date(BASE - TOTAL * 1000),
  periodEnd: new Date(BASE),
  commitClock: 'committed' as const,
};

describe('CommitsRepository', () => {
  it('instantiates with a db handle and exposes all methods', () => {
    const repo = new CommitsRepository({} as never);
    expect(typeof repo.upsertMany).toBe('function');
    expect(typeof repo.findById).toBe('function');
    expect(typeof repo.findPageByRepositorySince).toBe('function');
    expect(typeof repo.countByRepositorySince).toBe('function');
    expect(typeof repo.findWithCollaborators).toBe('function');
  });

  it('splits a large upsert into statements under the bind-parameter cap', async () => {
    const { db, batchSizes } = fakeDb();
    const rows = Array.from({ length: 4544 }, (_, i) => row(`sha${i}`));

    const out = await new CommitsRepository(db as never).upsertMany(rows);

    expect(batchSizes).toEqual([1000, 1000, 1000, 1000, 544]);
    // 15 bound columns per commit row, so every statement stays well under 65535.
    expect(Math.max(...batchSizes) * 15).toBeLessThan(65535);
    expect(out).toHaveLength(4544);
  });

  it('splits branch links the same way', async () => {
    const { db, batchSizes } = fakeDb();
    const ids = Array.from({ length: 2500 }, (_, i) => `c${i}`);

    await new CommitsRepository(db as never).linkToBranch(ids, 'main');

    expect(batchSizes).toEqual([1000, 1000, 500]);
  });

  it('pages a whole brief period instead of truncating it', async () => {
    // Fed oldest-first, so the ordering has to be the query's, not the input's.
    const { db, pageSizes } = fakeScopeDb([...expected].reverse());

    const out = await new CommitsRepository(db as never).findForBriefScope(
      scope,
    );

    expect(pageSizes).toEqual([PAGE, PAGE, TOTAL - PAGE * 2]);
    expect(out).toHaveLength(TOTAL);
    // Every row, once, newest first — nothing skipped or repeated at a boundary.
    expect(out.map((r) => r.commit.id)).toEqual(expected.map((r) => r.id));
    // The boundary this guards: the last two rows of page 1 and the first three
    // of page 2 share an `authoredAt`, which a timestamp-only cursor loses.
    const straddling = out.slice(PAGE - 2, PAGE + 3);
    expect(
      new Set(straddling.map((r) => r.commit.authoredAt.getTime())).size,
    ).toBe(1);
  });

  it('still does a single bounded read when a caller passes a limit', async () => {
    const { db, pageSizes } = fakeScopeDb([...expected].reverse());

    const out = await new CommitsRepository(db as never).findForBriefScope({
      ...scope,
      limit: 10,
    });

    expect(pageSizes).toEqual([10]);
    expect(out).toHaveLength(10);
  });
});
