import { Test } from '@nestjs/testing';
import type { Client } from '@temporalio/client';
import { KYSELY_DB, type AppDatabase } from '../../databases/kysely';
import { TEMPORAL_CLIENT } from '../../temporal';
import { HealthService } from '../health.service';

function build(opts: {
  dbFails?: boolean;
  temporalFails?: boolean;
  dbHangs?: boolean;
}) {
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

  const getSystemInfo = jest.fn(() =>
    opts.temporalFails
      ? Promise.reject(new Error('14 UNAVAILABLE: connection refused'))
      : Promise.resolve({ capabilities: {} }),
  );

  const temporal = {
    connection: { workflowService: { getSystemInfo } },
  } as unknown as Client;

  return { db, temporal, getSystemInfo, execute };
}

async function createService(opts: Parameters<typeof build>[0]) {
  const { db, temporal, getSystemInfo, execute } = build(opts);
  const moduleRef = await Test.createTestingModule({
    providers: [
      HealthService,
      { provide: KYSELY_DB, useValue: db },
      { provide: TEMPORAL_CLIENT, useValue: temporal },
    ],
  }).compile();
  return {
    service: moduleRef.get(HealthService),
    dbExecute: execute,
    getSystemInfo,
  };
}

describe('HealthService', () => {
  describe('liveness', () => {
    it('reports ok without touching any dependency', async () => {
      const { service, dbExecute, getSystemInfo } = await createService({
        dbFails: true,
        temporalFails: true,
      });

      const result = service.liveness();

      expect(result.status).toBe('ok');
      expect(typeof result.version).toBe('string');
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
      // The whole point of liveness: broken dependencies must not be consulted.
      expect(dbExecute).not.toHaveBeenCalled();
      expect(getSystemInfo).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('reports ok when both dependencies answer', async () => {
      const { service } = await createService({});

      const result = await service.readiness();

      expect(result.status).toBe('ok');
      expect(result.checks.database.status).toBe('ok');
      expect(result.checks.temporal.status).toBe('ok');
      expect(result.checks.database.error).toBeUndefined();
    });

    it('degrades and surfaces the reason when the database fails', async () => {
      const { service } = await createService({ dbFails: true });

      const result = await service.readiness();

      expect(result.status).toBe('degraded');
      expect(result.checks.database.status).toBe('error');
      expect(result.checks.database.error).toContain('ECONNREFUSED');
      // A database failure must not mask Temporal's state.
      expect(result.checks.temporal.status).toBe('ok');
    });

    it('degrades when Temporal is unreachable', async () => {
      const { service } = await createService({ temporalFails: true });

      const result = await service.readiness();

      expect(result.status).toBe('degraded');
      expect(result.checks.temporal.status).toBe('error');
      expect(result.checks.temporal.error).toContain('UNAVAILABLE');
      expect(result.checks.database.status).toBe('ok');
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
