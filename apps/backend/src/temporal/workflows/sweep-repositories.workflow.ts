// workflows/sweep-repositories.workflow.ts
import {
  startChild,
  continueAsNew,
  ParentClosePolicy,
} from '@temporalio/workflow';
import { slow } from './activity-proxies';
import { IngestNewCommitsWorkflow } from './ingest-new-commits.workflow';
import { buildSearchAttributes } from '../search-attributes';

/** Tracked (repository, branch) pairs planned per run; continue-as-new past it. */
const PAGE = 200;

export interface SweepRepositoriesInput {
  /** Position in the tracked set, set only by continue-as-new. */
  cursor?: { repositoryId: string; branch: string } | null;
  /**
   * Carried across continue-as-new so every child of one sweep shares a date, and
   * therefore an id. Stamped by the first page's activity — a workflow cannot
   * read a clock.
   */
  runDate?: string;
}

/**
 * Nightly catch-up: one incremental read per tracked (repository, branch),
 * whether or not a webhook arrived for it.
 *
 * The push path is the primary trigger and this is the backstop, for the cases a
 * webhook cannot cover: a delivery GitHub never sent or we rejected, a period
 * where the worker was down, a repository whose App subscription is missing the
 * `push` event, or commits pushed while the branch was being configured. It is
 * cheap by construction — every child runs the same `commits.planIngest` gate, so
 * a repository with nothing new costs two indexed queries and no GitHub call.
 *
 * Fan-out is one child per pair with `ParentClosePolicy.ABANDON`: this workflow is
 * a dispatcher, not a supervisor, and a slow repository must not hold the sweep
 * open. Children are deduped on `sweep:<repositoryId>:<branch>:<runDate>`, so a
 * manually re-run sweep on the same day reuses the existing runs instead of
 * starting a second set.
 *
 * System-scoped: it carries no `OrganizationId` itself (it spans every tenant),
 * while each child carries its own — that is what keeps the per-org background
 * jobs toast honest without inventing a fake owner for the sweep.
 */
export async function SweepRepositoriesWorkflow(
  input: SweepRepositoriesInput = {},
): Promise<void> {
  const page = await slow['commits.listSweepTargets']({
    limit: PAGE,
    after: input.cursor ?? null,
  });

  // The first page owns the date; continued runs keep it so ids stay stable even
  // if the sweep crosses midnight on a large install.
  const runDate = input.runDate ?? page.runDate;

  for (const target of page.targets) {
    await startChild(IngestNewCommitsWorkflow, {
      args: [
        {
          repositoryId: target.repositoryId,
          branch: target.branch,
          trigger: 'sweep' as const,
          runKey: runDate,
          organizationId: target.organizationId,
        },
      ],
      workflowId: `sweep:${target.repositoryId}:${target.branch}:${runDate}`,
      parentClosePolicy: ParentClosePolicy.ABANDON,
      searchAttributes: buildSearchAttributes({
        organizationId: target.organizationId,
        phase: 'fetching',
      }),
    });
  }

  if (page.nextCursor) {
    // Bare `continueAsNew` is correct here, unlike in `AnalyzeRepoWorkflow`: this
    // workflow carries no search attributes to preserve across the boundary.
    await continueAsNew<typeof SweepRepositoriesWorkflow>({
      cursor: page.nextCursor,
      runDate,
    });
  }
}
