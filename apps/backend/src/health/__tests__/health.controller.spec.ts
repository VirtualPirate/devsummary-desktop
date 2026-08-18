import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import type { HealthResponse } from '@launchstack/api-interfaces';
import { HealthController } from '../health.controller';
import { HealthService } from '../health.service';

const OK_REPORT: HealthResponse = {
  status: 'ok',
  version: 'v1',
  uptimeSeconds: 12,
  checks: {
    database: { status: 'ok', latencyMs: 1 },
    temporal: { status: 'ok', latencyMs: 2 },
  },
};

const DEGRADED_REPORT: HealthResponse = {
  status: 'degraded',
  version: 'v1',
  uptimeSeconds: 12,
  checks: {
    database: { status: 'ok', latencyMs: 1 },
    temporal: { status: 'error', latencyMs: 2000, error: '14 UNAVAILABLE' },
  },
};

async function createController(report: HealthResponse) {
  const readiness = jest.fn().mockResolvedValue(report);
  const liveness = jest.fn().mockReturnValue({
    status: 'ok' as const,
    version: 'v1',
    uptimeSeconds: 12,
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
  })
    .useMocker((token) =>
      token === HealthService ? { readiness, liveness } : undefined,
    )
    .compile();

  const status = jest.fn();
  const res = { status } as unknown as Response;

  return {
    controller: moduleRef.get(HealthController),
    res,
    status,
    liveness,
  };
}

describe('HealthController', () => {
  it('returns 200 when readiness is ok', async () => {
    const { controller, res, status } = await createController(OK_REPORT);

    const body = await controller.readiness(res);

    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(body.success).toBe(true);
    expect(body.message).toBe('OK');
    expect(body.data).toEqual(OK_REPORT);
  });

  it('returns 503 when a dependency is down, so `curl -f` and orchestrators fail', async () => {
    const { controller, res, status } = await createController(DEGRADED_REPORT);

    const body = await controller.readiness(res);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.success).toBe(false);
    expect(body.message).toBe('Degraded');
    // The failure detail must survive into the body, not just the status code.
    expect(body.data.checks.temporal.error).toContain('UNAVAILABLE');
  });

  it('liveness never sets a failure status and never consults readiness', async () => {
    const { controller, status, liveness } =
      await createController(DEGRADED_REPORT);

    const body = controller.liveness();

    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(liveness).toHaveBeenCalledTimes(1);
    // No Response is injected on this route, so no status can be overridden.
    expect(status).not.toHaveBeenCalled();
  });
});
