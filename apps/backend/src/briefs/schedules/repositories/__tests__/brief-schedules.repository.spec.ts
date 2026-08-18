import { BriefSchedulesRepository } from '../brief-schedules.repository';

describe('BriefSchedulesRepository.findDueForUpdate', () => {
  // Regression: findDueForUpdate previously used a raw SQL statement whose
  // rows are keyed by DB column names (snake_case, e.g. `cadence_type`).
  // The handler reads camelCase (`schedule.cadenceType`), so every field was
  // undefined and CadenceService.computePeriod fell through its switch and
  // returned undefined -> "Cannot read properties of undefined (reading 'start')".
  // The fix routes through the query builder (CamelCasePlugin maps rows to
  // camelCase), while preserving FOR UPDATE SKIP LOCKED via
  // `.forUpdate().skipLocked()`.
  it('selects due rows via the query builder with FOR UPDATE SKIP LOCKED', async () => {
    const rows = [{ id: 'sch1', cadenceType: 'daily', nextRunAt: new Date() }];
    const chain = {
      selectAll: jest.fn(),
      where: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
      forUpdate: jest.fn(),
      skipLocked: jest.fn(),
      execute: jest.fn().mockResolvedValue(rows),
    };
    chain.selectAll.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.forUpdate.mockReturnValue(chain);
    chain.skipLocked.mockReturnValue(chain);
    const tx = { selectFrom: jest.fn(() => chain) };

    const repo = new BriefSchedulesRepository({} as never);
    const result = await repo.findDueForUpdate(100, tx as never);

    expect(result).toEqual(rows);
    expect(tx.selectFrom).toHaveBeenCalledWith('briefs.briefSchedules');
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(chain.forUpdate).toHaveBeenCalledTimes(1);
    expect(chain.skipLocked).toHaveBeenCalledTimes(1);
  });
});
