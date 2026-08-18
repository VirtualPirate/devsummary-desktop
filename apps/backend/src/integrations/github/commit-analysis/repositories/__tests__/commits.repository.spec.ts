import { CommitsRepository } from '../commits.repository';

describe('CommitsRepository.findCommitTimestampsForScope', () => {
  it('returns [] without touching the db when repositoryIds is empty', async () => {
    const repo = new CommitsRepository({} as any);
    const out = await repo.findCommitTimestampsForScope({
      repositoryIds: [],
      periodStart: new Date('2025-06-06T00:00:00Z'),
      periodEnd: new Date('2026-06-06T00:00:00Z'),
      commitClock: 'committed',
    });
    expect(out).toEqual([]);
  });

  it('maps rows to the clock it was asked for', async () => {
    const authored = new Date('2026-01-01T10:00:00Z');
    const committed = new Date('2026-02-02T11:00:00Z');
    const chain: any = {
      select: () => chain,
      where: () => chain,
      execute: () =>
        Promise.resolve([{ authoredAt: authored, committedAt: committed }]),
    };
    const repo = new CommitsRepository({ selectFrom: () => chain } as never);
    const query = {
      repositoryIds: ['r1'],
      periodStart: new Date('2025-06-06T00:00:00Z'),
      periodEnd: new Date('2026-06-06T00:00:00Z'),
    };
    expect(
      await repo.findCommitTimestampsForScope({
        ...query,
        commitClock: 'committed',
      }),
    ).toEqual([committed]);
    // Bounding on one column and returning the other would place commits
    // outside the window the caller asked for.
    expect(
      await repo.findCommitTimestampsForScope({
        ...query,
        commitClock: 'authored',
      }),
    ).toEqual([authored]);
  });
});

// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const num = (v: unknown) => (v instanceof Date ? v.getTime() : v);

/**
 * Serves `findForBriefScope` while actually applying the scalar `where`s — the
 * opposite of the paging fake in `../../__tests__/commits.repository.spec.ts`,
 * which ignores them because it is testing the keyset instead. The callback
 * form (branch EXISTS, keyset cursor) is not what these cases exercise.
 */
function scopeDb(rows: Row[]) {
  const strip = (c: string) => c.replace(/^c\./, '');
  const preds: Array<(r: Row) => boolean> = [];
  const chain: any = {
    leftJoin: () => chain,
    selectAll: () => chain,
    select: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    where: (col: unknown, op?: string, val?: unknown) => {
      if (typeof col === 'function') return chain;
      preds.push((r) => {
        const left = num(r[strip(col as string)]);
        switch (op) {
          case 'in':
            return (val as unknown[]).includes(left);
          case '=':
            return left === num(val);
          case 'is':
            return left === val;
          case '>=':
            return (left as number) >= (num(val) as number);
          case '<':
            return (left as number) < (num(val) as number);
          default:
            throw new Error(`fake db: unhandled operator ${String(op)}`);
        }
      });
      return chain;
    },
    execute: () =>
      Promise.resolve(rows.filter((r) => preds.every((p) => p(r)))),
  };
  return { selectFrom: () => chain };
}

const commit = (over: Row): Row => ({
  id: 'c1',
  sha: 'sha1',
  repositoryId: 'r1',
  deletedAt: null,
  parentCount: 1,
  aId: null,
  ...over,
});

const PERIOD = {
  repositoryIds: ['r1'],
  periodStart: new Date('2026-01-26T00:00:00Z'),
  periodEnd: new Date('2026-02-02T00:00:00Z'),
};

describe('CommitsRepository.findForBriefScope commit clock', () => {
  /**
   * Audit finding 10, reproduced: a branch cut three weeks ago, rebased onto
   * main and merged inside this period. The committer date is the merge, which
   * is why ingestion fetched, stored and analysed it — the author date is
   * three weeks stale, which is why the old query filed it under a period whose
   * brief had already been generated and emailed, so it appeared in none.
   */
  const rebased = commit({
    authoredAt: new Date('2026-01-05T09:00:00Z'),
    committedAt: new Date('2026-01-27T14:00:00Z'),
  });

  it('includes it on the committer clock and not on the author clock', async () => {
    const repo = () => new CommitsRepository(scopeDb([rebased]) as never);

    const onCommitted = await repo().findForBriefScope({
      ...PERIOD,
      commitClock: 'committed',
    });
    expect(onCommitted.map((r) => r.commit.sha)).toEqual(['sha1']);

    // The other half of the snapshot: a brief written before the switch keeps
    // selecting the set it reported, so its stored commit_count still matches.
    const onAuthored = await repo().findForBriefScope({
      ...PERIOD,
      commitClock: 'authored',
    });
    expect(onAuthored).toEqual([]);
  });

  it('stays half-open on the new column', async () => {
    const rows = [
      commit({
        id: 'lo',
        sha: 'at-start',
        authoredAt: PERIOD.periodStart,
        committedAt: PERIOD.periodStart,
      }),
      commit({
        id: 'hi',
        sha: 'at-end',
        authoredAt: PERIOD.periodEnd,
        // periodEnd is the next period's start: including it would put this
        // commit in two consecutive briefs.
        committedAt: PERIOD.periodEnd,
      }),
    ];
    const out = await new CommitsRepository(
      scopeDb(rows) as never,
    ).findForBriefScope({ ...PERIOD, commitClock: 'committed' });
    expect(out.map((r) => r.commit.sha)).toEqual(['at-start']);
  });

  it('throws on a junk clock rather than composing SQL', async () => {
    await expect(
      new CommitsRepository(scopeDb([rebased]) as never).findForBriefScope({
        ...PERIOD,
        commitClock: 'landed' as never,
      }),
    ).rejects.toThrow(/unknown commit clock/);
  });
});
