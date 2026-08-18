/**
 * Health/readiness reporting for the backend (`GET /api/health*`).
 *
 * Two distinct signals, deliberately split:
 *   - liveness  — "the process is up and serving HTTP". Touches no dependency.
 *   - readiness — "the process can actually do work". Probes the database.
 *
 * Restart-on-failure should watch liveness only. Wiring a restart to readiness
 * turns a transient database blip into a crash loop.
 */

/** Overall readiness verdict. `degraded` means at least one dependency failed. */
export type HealthStatus = "ok" | "degraded";

/** Per-dependency verdict. */
export type DependencyStatus = "ok" | "error";

export interface HealthCheckResult {
  status: DependencyStatus;
  /** Wall-clock duration of the probe, including a failed/timed-out one. */
  latencyMs: number;
  /** Failure reason. Present only when `status` is `error`. */
  error?: string;
}

export interface HealthResponse {
  status: HealthStatus;
  version: string;
  uptimeSeconds: number;
  checks: {
    /** `select 1` against the local PGlite database via Kysely. */
    database: HealthCheckResult;
  };
}

export interface LivenessResponse {
  status: "ok";
  version: string;
  uptimeSeconds: number;
}
