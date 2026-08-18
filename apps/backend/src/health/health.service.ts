import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { Client } from '@temporalio/client';
import { API_VERSION } from '@launchstack/core';
import type {
  HealthCheckResult,
  HealthResponse,
  LivenessResponse,
} from '@launchstack/api-interfaces';
import { KYSELY_DB, type AppDatabase } from '../databases/kysely';
import { TEMPORAL_CLIENT } from '../temporal';

/**
 * Per-probe budget. A health endpoint that can hang is worse than none at all:
 * an orchestrator waiting on it reports "starting" instead of "unhealthy", so
 * every probe is raced against this deadline and a timeout counts as a failure.
 */
const CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
  ) {}

  /**
   * Liveness: is this process up. Deliberately touches nothing external, so a
   * Postgres or Temporal outage can never cause a restart loop here.
   */
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      version: API_VERSION,
      uptimeSeconds: uptimeSeconds(),
    };
  }

  /**
   * Readiness: can this process serve real requests. Probes run concurrently so
   * total latency is the slowest check, not their sum, and one failing
   * dependency never masks the state of the other.
   */
  async readiness(): Promise<HealthResponse> {
    const [database, temporal] = await Promise.all([
      this.probe('database', () => sql`select 1`.execute(this.db)),
      // getSystemInfo is served by the Temporal frontend, so a successful
      // response proves both TCP reachability and that the service is serving —
      // the same thing `tctl cluster health` establishes.
      this.probe('temporal', () =>
        this.temporal.connection.workflowService.getSystemInfo({}),
      ),
    ]);

    const healthy = database.status === 'ok' && temporal.status === 'ok';

    return {
      status: healthy ? 'ok' : 'degraded',
      version: API_VERSION,
      uptimeSeconds: uptimeSeconds(),
      checks: { database, temporal },
    };
  }

  private async probe(
    name: string,
    run: () => PromiseLike<unknown>,
  ): Promise<HealthCheckResult> {
    const startedAt = Date.now();
    try {
      await withTimeout(run(), CHECK_TIMEOUT_MS, name);
      return { status: 'ok', latencyMs: Date.now() - startedAt };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn(`health probe "${name}" failed: ${error}`);
      return { status: 'error', latencyMs: Date.now() - startedAt, error };
    }
  }
}

function uptimeSeconds(): number {
  return Math.round(process.uptime());
}

async function withTimeout<T>(
  work: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} probe timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    // Without this the pending timer keeps a handle alive after a fast success,
    // which would stall graceful shutdown by up to CHECK_TIMEOUT_MS.
    if (timer) clearTimeout(timer);
  }
}
