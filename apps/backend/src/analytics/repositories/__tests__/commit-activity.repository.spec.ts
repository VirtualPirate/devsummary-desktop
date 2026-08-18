import { CommitActivityRepository } from '../commit-activity.repository';

function makeDb(rows: unknown[]) {
  const execute = jest.fn(() => Promise.resolve(rows));
  const builder: Record<string, jest.Mock> = {};
  for (const method of [
    'innerJoin',
    'leftJoin',
    'where',
    'select',
    'groupBy',
    'orderBy',
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  builder.execute = execute;
  const selectFrom = jest.fn(() => builder);
  return { db: { selectFrom }, selectFrom, where: builder.where };
}

const baseArgs = {
  organizationId: 'org-1',
  from: new Date('2026-06-01T00:00:00Z'),
  to: new Date('2026-06-08T00:00:00Z'),
  granularity: 'day' as const,
  timezone: 'UTC',
};

describe('CommitActivityRepository.aggregate', () => {
  it('runs a single grouped query and returns its rows', async () => {
    const rows = [
      {
        bucket: '2026-06-01',
        commits: 4,
        additions: 100,
        deletions: 20,
        feature: 2,
        fix: 1,
        optimization: 0,
        refactor: 0,
        docs: 0,
        test: 0,
        chore: 0,
      },
    ];
    const { db, selectFrom } = makeDb(rows);
    const repo = new CommitActivityRepository(db as never);
    const result = await repo.aggregate(baseArgs);
    expect(result).toEqual(rows);
    expect(selectFrom).toHaveBeenCalledTimes(1);
  });

  it('accepts optional repository and collaborator filters', async () => {
    const { db } = makeDb([]);
    const repo = new CommitActivityRepository(db as never);
    const result = await repo.aggregate({
      ...baseArgs,
      repositoryId: 'repo-1',
      authorGithubUserId: 99n,
    });
    expect(result).toEqual([]);
  });

  it('translates PG unrecognized-timezone errors (22023) into a 400 AppError', async () => {
    const pgError = Object.assign(
      new Error('time zone "Asia/Atlantis" not recognized'),
      { code: '22023' },
    );
    const wrapped = Object.assign(new Error('Failed query: select ...'), {
      cause: pgError,
    });
    const { db } = makeDb([]);
    const repo = new CommitActivityRepository(db as never);
    jest
      .spyOn(
        repo as unknown as { runAggregate: () => Promise<unknown> },
        'runAggregate',
      )
      .mockRejectedValueOnce(wrapped);
    await expect(
      repo.aggregate({ ...baseArgs, timezone: 'Asia/Atlantis' }),
    ).rejects.toMatchObject({ code: 'ANALYTICS_TIMEZONE_UNSUPPORTED' });
  });
});
