import { GithubRepositoriesRepository } from '../repositories/repositories.repository';
import type { RepoReconcileRow } from '../repositories/repositories.repository';

/**
 * Records the row count of every insert statement and the keep list of every
 * `not in` delete. Postgres binds parameters as int16, so a single statement may
 * carry at most 65535 of them; a repository row binds 6 columns plus 2 in the
 * conflict clause, which is why the reconcile must split large installations —
 * and one parameter per id, which is why the delete must stay one statement.
 */
function fakeDb() {
  const batchSizes: number[] = [];
  const keepLists: unknown[][] = [];
  const noop = () => ({ columns: () => ({ doUpdateSet: noop }) });
  const update = {
    set: () => update,
    where: (_column: string, op: string, value: unknown) => {
      if (op === 'not in') keepLists.push(value as unknown[]);
      return update;
    },
    execute: () => Promise.resolve(undefined),
  };
  const db = {
    insertInto: () => ({
      values: (rows: unknown[]) => {
        batchSizes.push(rows.length);
        return {
          onConflict: (cb: (oc: unknown) => unknown) => {
            cb(noop());
            return { execute: () => Promise.resolve(undefined) };
          },
        };
      },
    }),
    updateTable: () => update,
  };
  return { db, batchSizes, keepLists };
}

const row = (i: number): RepoReconcileRow => ({
  githubRepoId: BigInt(i),
  name: `repo${i}`,
  fullName: `acme/repo${i}`,
  private: false,
  raw: null,
});

describe('GithubRepositoriesRepository', () => {
  it('instantiates with a db handle and exposes all methods', () => {
    const repo = new GithubRepositoriesRepository({} as never);

    expect(typeof repo.listByInstallation).toBe('function');
    expect(typeof repo.reconcileForInstallation).toBe('function');
    expect(typeof repo.softDeleteAllForInstallation).toBe('function');
    expect(typeof repo.findByGithubRepoId).toBe('function');
    expect(typeof repo.findByIdIncludingDeleted).toBe('function');
  });

  it('splits a large reconcile into statements under the bind-parameter cap', async () => {
    const { db, batchSizes } = fakeDb();
    const rows = Array.from({ length: 10920 }, (_, i) => row(i));

    await new GithubRepositoriesRepository(
      db as never,
    ).reconcileForInstallation('installation-1', rows);

    expect(batchSizes).toEqual([...Array<number>(10).fill(1000), 920]);
    // 6 bound columns per repository row plus 2 in the conflict clause.
    expect(Math.max(...batchSizes) * 8).toBeLessThan(65535);
  });

  it('keeps the soft-delete a single statement over every kept id', async () => {
    const { db, keepLists } = fakeDb();
    const rows = Array.from({ length: 10920 }, (_, i) => row(i));

    await new GithubRepositoriesRepository(
      db as never,
    ).reconcileForInstallation('installation-1', rows);

    // Chunking this would soft-delete every repository outside each batch.
    expect(keepLists).toHaveLength(1);
    expect(keepLists[0]).toHaveLength(10920);
  });
});
