import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { API_VERSION } from '@launchstack/core';
import type {
  HealthCheckResult,
  HealthResponse,
  LivenessResponse,
} from '@launchstack/api-interfaces';
import { KYSELY_DB, type AppDatabase } from '../databases/kysely';

/**
 * Per-probe budget. A health endpoint that can hang is worse than none at all:
 * an orchestrator waiting on it reports "starting" instead of "unhealthy", so
 * every probe is raced against this deadline and a timeout counts as a failure.
 */
const CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  /**
   * Liveness: is this process up. Deliberately touches nothing external, so a
   * database outage can never cause a restart loop here.
   */
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      version: API_VERSION,
      uptimeSeconds: uptimeSeconds(),
    };
  }

  /**
   * Readiness: can this process serve real requests. One dependency now — the
   * embedded database. The Temporal probe is gone with Temporal itself, and the
   * job runner is in-process, so "is the runner up" is answered by liveness.
   */
  async readiness(): Promise<HealthResponse> {
    const database = await this.probe('database', () =>
      sql`select 1`.execute(this.db),
    );

    const healthy = database.status === 'ok';

    return {
      status: healthy ? 'ok' : 'degraded',
      version: API_VERSION,
      uptimeSeconds: uptimeSeconds(),
      checks: { database },
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
