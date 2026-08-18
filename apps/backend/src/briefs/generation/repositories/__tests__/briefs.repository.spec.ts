import { BriefsRepository } from '../briefs.repository';

describe('BriefsRepository.list', () => {
  function makeDb(rows: unknown[]) {
    const chain = {
      selectAll: jest.fn(),
      where: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
      execute: jest.fn().mockResolvedValue(rows),
    };
    chain.selectAll.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    return { selectFrom: jest.fn(() => chain) };
  }

  it('returns rows without cursor condition when no cursor provided', async () => {
    const rows = [{ id: 'a', createdAt: new Date() }];
    const repo = new BriefsRepository(makeDb(rows) as never);
    const result = await repo.list({ organizationId: 'org1', limit: 10 });
    expect(result).toEqual(rows);
  });

  it('returns rows when cursor is provided', async () => {
    const rows = [{ id: 'b', createdAt: new Date('2026-06-01T00:00:00Z') }];
    const repo = new BriefsRepository(makeDb(rows) as never);
    const result = await repo.list({
      organizationId: 'org1',
      limit: 10,
      cursorPeriodEnd: new Date('2026-06-07T16:16:38.264Z'),
      cursorId: 'e2861e81-15d2-46ac-b291-f152b7af2668',
    });
    expect(result).toEqual(rows);
  });

  it('builds query with date range and excludeNoActivity filters', async () => {
    const rows = [{ id: 'c', createdAt: new Date() }];
    const repo = new BriefsRepository(makeDb(rows) as never);
    const result = await repo.list({
      organizationId: 'org1',
      limit: 10,
      periodEndFrom: new Date('2026-06-01T00:00:00Z'),
      periodEndTo: new Date('2026-06-08T00:00:00Z'),
      excludeNoActivity: true,
    });
    expect(result).toEqual(rows);
  });

  /**
   * `period_end` is exclusive, so the brief covering Jun 7 ends at exactly
   * Jun 8 00:00. Filtering "from Jun 8" must not return it — with the `>=` this
   * used to use, every "from" filter leaked in the brief for the day before.
   *
   * The fake evaluates the recorded predicates rather than just recording them:
   * an operator assertion would pass on `>=` if someone re-read the comment the
   * wrong way round.
   */
  it('excludes a brief whose period_end sits exactly on the from boundary', async () => {
    const jun7 = { id: 'jun7', periodEnd: new Date('2026-06-08T00:00:00Z') };
    const jun8 = { id: 'jun8', periodEnd: new Date('2026-06-09T00:00:00Z') };

    const ops: Record<string, (a: Date, b: Date) => boolean> = {
      '>': (a, b) => a.getTime() > b.getTime(),
      '>=': (a, b) => a.getTime() >= b.getTime(),
      '<': (a, b) => a.getTime() < b.getTime(),
      '<=': (a, b) => a.getTime() <= b.getTime(),
    };
    let rows = [jun7, jun8];
    const chain = {
      selectAll: jest.fn(),
      where: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
      execute: jest.fn(() => Promise.resolve(rows)),
    };
    chain.selectAll.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.where.mockImplementation(
      (column: unknown, op?: string, value?: unknown) => {
        if (column === 'periodEnd' && op && value instanceof Date) {
          rows = rows.filter((r) => ops[op](r.periodEnd, value));
        }
        return chain;
      },
    );

    const repo = new BriefsRepository({
      selectFrom: jest.fn(() => chain),
    } as never);

    const result = await repo.list({
      organizationId: 'org1',
      limit: 10,
      periodEndFrom: new Date('2026-06-08T00:00:00Z'),
      periodEndTo: new Date('2026-06-09T00:00:00Z'),
    });

    // Jun 8's brief ends exactly at the exclusive `to` and is kept; Jun 7's ends
    // exactly at `from` and is dropped.
    expect(result.map((r) => r.id)).toEqual(['jun8']);
  });
});

describe('BriefsRepository.findPeriodStartsForSchedule', () => {
  it('returns a Set of periodStart epoch-millis', async () => {
    const a = new Date('2026-05-18T00:00:00Z');
    const b = new Date('2026-05-25T00:00:00Z');
    const chain = {
      select: jest.fn(),
      where: jest.fn(),
      execute: jest
        .fn()
        .mockResolvedValue([{ periodStart: a }, { periodStart: b }]),
    };
    chain.select.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    const fakeDb = { selectFrom: jest.fn(() => chain) };
    const repo = new BriefsRepository(fakeDb as never);
    const out = await repo.findPeriodStartsForSchedule(
      'sch1',
      new Date('2025-06-06T00:00:00Z'),
    );
    expect(out.has(a.getTime())).toBe(true);
    expect(out.has(b.getTime())).toBe(true);
    expect(out.size).toBe(2);
  });
});
