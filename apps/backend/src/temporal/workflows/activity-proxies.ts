import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities.interface';

// retryLimit 3, retryDelay 30, backoff -> maximumAttempts 4
const standard = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 4, initialInterval: '30s', backoffCoefficient: 2 },
});

// retryLimit 3, retryDelay 60, backoff (loc-stats, backfill-briefs)
const slow = proxyActivities<Activities>({
  startToCloseTimeout: '15 minutes',
  retry: { maximumAttempts: 4, initialInterval: '60s', backoffCoefficient: 2 },
});

// retryLimit 2, no delay tuning (analyze-repo planning)
const twice = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 3, initialInterval: '1s', backoffCoefficient: 2 },
});

// retryLimit 0 (dispatch claim, noop)
const once = proxyActivities<Activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 1 },
});

/**
 * GitHub commit ingestion (`commits.backfillFromLatest`, `commits.backfill`).
 *
 * Its own profile rather than `standard` because `heartbeatTimeout` only makes
 * sense for activities that actually heartbeat: `standard` is shared with the
 * brief and per-commit analysis activities, which don't, and every one of them
 * would start failing the moment it was set there.
 *
 * These two page a whole lookback window in a single activity, so their runtime
 * is bounded by repository size, not by a fixed slice of work — under
 * `standard`'s 10 minutes a big enough repository is killed and retried from
 * page 1 forever, never finishing. The heartbeat is the real liveness check (a
 * page fetch plus its write is seconds; 5 minutes leaves room for GitHub
 * rate-limit backoff), which leaves `startToCloseTimeout` as a backstop against
 * a run that never ends rather than the thing policing progress.
 *
 * Moving an existing call from `standard` to here changes timeouts only — same
 * activity type at the same call site — so in-flight executions replay fine.
 */
const ingest = proxyActivities<Activities>({
  startToCloseTimeout: '2 hours',
  heartbeatTimeout: '5 minutes',
  retry: { maximumAttempts: 4, initialInterval: '30s', backoffCoefficient: 2 },
});

export { standard, slow, twice, once, ingest };
