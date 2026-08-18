// workflows/ingest-new-commits.workflow.ts
import { startChild, ParentClosePolicy } from '@temporalio/workflow';
import { ingest, twice } from './activity-proxies';
import { AnalyzeRepoWorkflow } from './analyze-repo.workflow';
import { buildSearchAttributes } from '../search-attributes';

/**
 * How far back an *adopted* branch is read — one with no stored history, so there
 * is no high-water mark to resume from. Bounds what is otherwise "everything
 * GitHub will give us": measured from the branch's newest commit, not from now, so
 * a dormant repository is still adopted rather than skipped for being quiet.
 *
 * ponytail: a constant, not an env var — nothing has asked to tune it per install,
 * and a workflow constant stays in replay history. Lift it to config the first time
 * ops needs a different number.
 */
const ADOPT_LOOKBACK_DAYS = 30;

export interface IngestNewCommitsInput {
  repositoryId: string;
  branch: string;
  /**
   * Why this run exists. Only affects ids and logs — the work is identical, which
   * is the point of one workflow rather than two near-copies.
   */
  trigger: 'push' | 'sweep';
  /** Whatever makes this run distinct: the head sha for a push, the date for a sweep. */
  runKey: string;
  /** Shas the trigger named, head commit included. Empty for a sweep. */
  shas?: string[];
  /** True when the trigger's list is known to be incomplete (GitHub truncates large pushes). */
  truncated?: boolean;
  earliestPushedISO?: string | null;
  organizationId?: string;
}

/**
 * An incremental read of one (repository, branch): plan, fetch the tail, analyse
 * it. Started by the `push` webhook and by the nightly sweep.
 *
 * Separate from `BackfillCommitsWorkflow` (which only fetches) rather than
 * bolting a child analysis start onto it: that would change what
 * `POST /commits/backfill` does and be a non-deterministic change for any
 * backfill already in flight. Shaped after `ScanRepositoryWorkflow` instead,
 * which is the other flow that fetches *and* analyses.
 *
 * The plan step is what keeps a run cheap — see `commits.planIngest`. A `skip`
 * means the trigger told us nothing new and no GitHub call is made, which is the
 * common case for a sweep on a repository that has been quiet all day. A branch
 * with no stored history is *adopted* instead of skipped: see `ADOPT_LOOKBACK_DAYS`.
 */
export async function IngestNewCommitsWorkflow(
  input: IngestNewCommitsInput,
): Promise<void> {
  const plan = await twice['commits.planIngest']({
    repositoryId: input.repositoryId,
    branch: input.branch,
    shas: input.shas ?? [],
    truncated: input.truncated ?? false,
    earliestPushedISO: input.earliestPushedISO ?? null,
  });
  if (plan.skip !== null) return;

  // Two shapes of read. `resume` continues from what is stored; `adopt` is the
  // first read of a branch that has nothing — the same activity (and therefore the
  // same "latest commit minus lookback" window) `ScanRepositoryWorkflow` uses, so
  // a branch whose setup scan never landed converges on the next run rather than
  // staying empty forever.
  let sinceISO: string;
  if (plan.mode === 'adopt') {
    const adopted = await ingest['commits.backfillFromLatest']({
      repositoryId: input.repositoryId,
      branch: input.branch,
      lookbackDays: ADOPT_LOOKBACK_DAYS,
    });
    // Null means GitHub reports no commits on the branch at all — a genuinely
    // empty repository. Nothing to analyse, and nothing to store as a mark, so the
    // next run adopts it again (one cheap API call a night until it has a commit).
    if (adopted.sinceISO === null) return;
    sinceISO = adopted.sinceISO;
  } else {
    await ingest['commits.backfill']({
      repositoryId: input.repositoryId,
      branch: input.branch,
      sinceISO: plan.sinceISO,
    });
    sinceISO = plan.sinceISO;
  }

  await startChild(AnalyzeRepoWorkflow, {
    args: [
      {
        repositoryId: input.repositoryId,
        sinceISO,
        force: false,
        organizationId: input.organizationId,
      },
    ],
    // Keyed on `runKey`, not on `sinceISO`: two runs minutes apart can derive the
    // same window, and a second child with a live id would fail the start. Same
    // `analyze:<repositoryId>:…` shape `IngestStatusService` reads a repository
    // out of.
    workflowId: `analyze:${input.repositoryId}:${input.branch}:${input.runKey}`,
    parentClosePolicy: ParentClosePolicy.ABANDON,
    // Only spread the org key when there is one — `buildSearchAttributes` throws
    // on a present-but-empty organization id.
    searchAttributes: buildSearchAttributes({
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      phase: 'analyzing',
    }),
  });
}
