import { Test } from '@nestjs/testing';
import { KYSELY_DB, type AppDatabase } from '../../databases/kysely';
import { HealthService } from '../health.service';

function build(opts: { dbFails?: boolean; dbHangs?: boolean }) {
  // Held as a standalone reference (not read back off `db`) so assertions do not
  // trip the unbound-method lint rule.
  const execute = jest.fn(() => {
    if (opts.dbHangs) return new Promise(() => {}); // never settles
    return opts.dbFails
      ? Promise.reject(new Error('ECONNREFUSED 5432'))
      : Promise.resolve({ rows: [{ '?column?': 1 }] });
  });

  // `sql\`select 1\`.execute(db)` resolves db.getExecutor() and runs the
  // compiled query through it, so the mock stands in at the executor level.
  const db = {
    getExecutor: () => ({
      transformQuery: (node: unknown) => node,
      compileQuery: () => ({ sql: 'select 1', parameters: [] }),
      executeQuery: execute,
    }),
  } as unknown as AppDatabase;

  return { db, execute };
}

async function createService(opts: Parameters<typeof build>[0]) {
  const { db, execute } = build(opts);
  const moduleRef = await Test.createTestingModule({
    providers: [HealthService, { provide: KYSELY_DB, useValue: db }],
  }).compile();
  return { service: moduleRef.get(HealthService), dbExecute: execute };
}

describe('HealthService', () => {
  describe('liveness', () => {
    it('reports ok without touching any dependency', async () => {
      const { service, dbExecute } = await createService({ dbFails: true });

      const result = service.liveness();

      expect(result.status).toBe('ok');
      expect(typeof result.version).toBe('string');
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
      // The whole point of liveness: a broken database must not be consulted.
      expect(dbExecute).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('reports ok when the database answers', async () => {
      const { service } = await createService({});

      const result = await service.readiness();

      expect(result.status).toBe('ok');
      expect(result.checks.database.status).toBe('ok');
      expect(result.checks.database.error).toBeUndefined();
    });

    it('degrades and surfaces the reason when the database fails', async () => {
      const { service } = await createService({ dbFails: true });

      const result = await service.readiness();

      expect(result.status).toBe('degraded');
      expect(result.checks.database.status).toBe('error');
      expect(result.checks.database.error).toContain('ECONNREFUSED');
    });

    it('times out a hanging probe instead of hanging the request', async () => {
      jest.useFakeTimers();
      try {
        const { service } = await createService({ dbHangs: true });

        const pending = service.readiness();
        await jest.advanceTimersByTimeAsync(2_100);
        const result = await pending;

        expect(result.status).toBe('degraded');
        expect(result.checks.database.status).toBe('error');
        expect(result.checks.database.error).toContain('timed out');
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
