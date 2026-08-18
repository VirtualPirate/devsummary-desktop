// workflows/analyze-repo.workflow.ts
import { twice, standard } from './activity-proxies';
import { makeContinueAsNewFunc } from '@temporalio/workflow';
import { buildSearchAttributes } from '../search-attributes';

const BATCH = 50;
const PAGE = 500; // commits planned per run; continue-as-new past it to bound history

export interface AnalyzeRepoInput {
  repositoryId: string;
  sinceISO: string;
  force: boolean;
  organizationId?: string;
  /**
   * Position in the repository's history, set on continue-as-new. Two fields,
   * deliberately: carrying the *remaining commit ids* instead would put an
   * unbounded array in the workflow argument, and Temporal caps a payload at
   * 2 MB (warns at 256 KB) — around 6.7k commits. See `docs/scale-ceilings.md`.
   */
  cursor?: { authoredAt: string; id: string } | null;
}

export async function AnalyzeRepoWorkflow(
  input: AnalyzeRepoInput,
): Promise<void> {
  // One page per run, planned fresh each time: the planner pages by cursor, so
  // a continued run asks for the next page rather than replaying a list.
  const planned = await twice['analysis.planRepoAnalysis']({
    repositoryId: input.repositoryId,
    sinceISO: input.sinceISO,
    force: input.force,
    limit: PAGE,
    after: input.cursor ?? null,
  });

  for (let i = 0; i < planned.commitIds.length; i += BATCH) {
    const batch = planned.commitIds.slice(i, i + BATCH);
    // allSettled (not all): a single commit exhausting its activity retries
    // must not abort the rest of the batch/run/remaining pages — the activity
    // already persisted the per-commit failure (recordFailed) before throwing,
    // so nothing is silently lost here.
    await Promise.allSettled(
      batch.map((commitId) => standard['analysis.analyzeCommit']({ commitId })),
    );
  }

  if (planned.nextCursor) {
    // Bare `continueAsNew` emits `searchAttributes: undefined`, so the continued
    // run keeping OrganizationId/Phase would rest on server-side carry-over that
    // nothing here verifies — a >500-commit repo would drop out of its org's
    // `analyzing` count mid-run and the toast would report "done". Set them
    // explicitly. Only spread the org key when we have one: `buildSearchAttributes`
    // rejects a present-but-empty organizationId.
    const continueAsNew = makeContinueAsNewFunc<typeof AnalyzeRepoWorkflow>({
      searchAttributes: buildSearchAttributes({
        ...(input.organizationId
          ? { organizationId: input.organizationId }
          : {}),
        phase: 'analyzing',
      }),
    });
    await continueAsNew({ ...input, cursor: planned.nextCursor });
  }
}
