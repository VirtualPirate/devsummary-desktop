// workflows/scan-repository.workflow.ts
import { ingest } from './activity-proxies';
import { startChild, ParentClosePolicy } from '@temporalio/workflow';
import { AnalyzeRepoWorkflow } from './analyze-repo.workflow';
import { buildSearchAttributes } from '../search-attributes';

export async function ScanRepositoryWorkflow(input: {
  repositoryId: string;
  branch: string;
  lookbackDays: number;
  organizationId?: string;
}): Promise<void> {
  const { sinceISO } = await ingest['commits.backfillFromLatest']({
    repositoryId: input.repositoryId,
    branch: input.branch,
    lookbackDays: input.lookbackDays,
  });
  if (sinceISO === null) return;

  await startChild(AnalyzeRepoWorkflow, {
    args: [
      {
        repositoryId: input.repositoryId,
        sinceISO,
        force: false,
        organizationId: input.organizationId,
      },
    ],
    // Explicit id, not the auto-generated one, so the repository is readable from
    // the workflow id — that is what lets the onboarding console report analysis
    // progress *per repository* without a `RepositoryId` search attribute (see
    // `IngestStatusService`). Same `analyze:<repositoryId>:…` shape the manual
    // endpoint uses; `branch` keeps it distinct if a repository ever reads two.
    //
    // Changing a child's id is a non-deterministic change for any
    // ScanRepositoryWorkflow already in flight — on a live cluster this needs a
    // `patched()` guard rather than a straight edit.
    workflowId: `analyze:${input.repositoryId}:${input.branch}:${sinceISO}`,
    parentClosePolicy: ParentClosePolicy.ABANDON,
    // Spread conditionally: `buildSearchAttributes` now throws on a
    // present-but-empty org id, so passing the optional field straight through
    // would turn a missing one into a workflow-task failure instead of
    // system-scoped work.
    searchAttributes: buildSearchAttributes({
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      phase: 'analyzing',
    }),
  });
}
