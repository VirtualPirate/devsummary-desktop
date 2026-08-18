// workflows/backfill-loc-stats.workflow.ts
import { slow } from './activity-proxies';
import { startChild, ParentClosePolicy } from '@temporalio/workflow';
import { BackfillRepoLocStatsWorkflow } from './backfill-repo-loc-stats.workflow';

export async function BackfillLocStatsWorkflow(): Promise<void> {
  const { repositoryIds } = await slow['loc.zeroFillAndFindMissing']();
  for (const repositoryId of repositoryIds) {
    await startChild(BackfillRepoLocStatsWorkflow, {
      args: [{ repositoryId, cursor: null }],
      parentClosePolicy: ParentClosePolicy.ABANDON,
    });
  }
}
