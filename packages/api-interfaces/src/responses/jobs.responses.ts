/**
 * Live background-job activity for the current organization, grouped into the
 * three brief-pipeline phases. Counts are of in-flight pg-boss jobs
 * (queued / retrying / running) resolved to this org.
 */
export interface JobActivityResponse {
  /** True when any phase has in-flight work. */
  active: boolean;
  /** Repositories being pulled from GitHub (scan + commit backfill). */
  fetching: number;
  /** Commits being classified by the AI (repo + per-commit analysis). */
  analyzing: number;
  /** Briefs being generated (ad-hoc, scheduled dispatch, or backfill). */
  generating: number;
}
