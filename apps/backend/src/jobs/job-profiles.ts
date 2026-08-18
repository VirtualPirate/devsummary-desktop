/**
 * Job type names and their retry profiles.
 *
 * This is the mapping seam between the queue and the handlers: `JOB` names every
 * type the app can enqueue, `PROFILE_BY_TYPE` says how hard each one retries.
 * Phase 4 fills `job-handlers.ts` with the implementations; nothing here changes
 * when it does.
 */

/** The old `Phase` search attribute, now the `phase` column on a job row. */
export type Phase = 'fetching' | 'analyzing' | 'generating';

/**
 * Every background job type. One entry per Temporal workflow that survived the
 * port (`NoopWorkflow` did not). Callers reference these instead of string
 * literals, exactly as they referenced `WORKFLOW` before.
 */
export const JOB = {
  dispatchDueBriefs: 'briefs.dispatchDue',
  generateBrief: 'briefs.generate',
  backfillBriefs: 'briefs.backfill',
  analyzeRepo: 'analysis.analyzeRepo',
  sweepRepositories: 'github.sweep',
  ingestNewCommits: 'github.ingestNewCommits',
  scanRepository: 'github.scanRepository',
  backfillCommits: 'github.backfillCommits',
  backfillLocStats: 'loc.backfill',
  backfillRepoLocStats: 'loc.backfillRepo',
  syncRepoCollaborators: 'collaborators.syncRepo',
} as const;

export type JobType = (typeof JOB)[keyof typeof JOB];

/**
 * Carried over verbatim from `temporal/workflows/activity-proxies.ts` — the
 * existing retry behaviour was tuned against these numbers.
 *
 * `startToCloseTimeout` and `heartbeatTimeout` are dropped: they existed to stop
 * a Temporal worker from sitting on a task forever while the server waited. In
 * process there is no scheduler to defeat — a hung handler hangs one of the two
 * loops and nothing else, and killing it would only re-run it from page 1.
 */
export const PROFILES = {
  standard: { maxAttempts: 4, initialMs: 30_000, factor: 2 },
  slow: { maxAttempts: 4, initialMs: 60_000, factor: 2 },
  twice: { maxAttempts: 3, initialMs: 1_000, factor: 2 },
  once: { maxAttempts: 1, initialMs: 0, factor: 1 },
  ingest: { maxAttempts: 4, initialMs: 30_000, factor: 2 },
} as const;

export type ProfileName = keyof typeof PROFILES;

/**
 * Which proxy each workflow used for its *own* work. A job is one attempt at a
 * whole handler now, not per activity call, so a handler that used two proxies
 * takes the one that governed the call that can actually fail against a third
 * party.
 */
const PROFILE_BY_TYPE: Record<string, ProfileName> = {
  // `claimDue` advanced `nextRunAt` inside its own transaction — a retry races
  // the next tick rather than helping, which is why it was `once`.
  [JOB.dispatchDueBriefs]: 'once',
  [JOB.generateBrief]: 'standard',
  [JOB.backfillBriefs]: 'slow',
  [JOB.analyzeRepo]: 'twice',
  [JOB.sweepRepositories]: 'slow',
  [JOB.ingestNewCommits]: 'ingest',
  [JOB.scanRepository]: 'ingest',
  [JOB.backfillCommits]: 'ingest',
  [JOB.backfillLocStats]: 'slow',
  [JOB.backfillRepoLocStats]: 'slow',
  [JOB.syncRepoCollaborators]: 'standard',
};

export function profileFor(type: string): (typeof PROFILES)[ProfileName] {
  return PROFILES[PROFILE_BY_TYPE[type] ?? 'standard'];
}

/** Delay before the next attempt of a job that has failed `attempts` times. */
export function backoffMs(type: string, attempts: number): number {
  const p = profileFor(type);
  return p.initialMs * p.factor ** Math.max(0, attempts - 1);
}
