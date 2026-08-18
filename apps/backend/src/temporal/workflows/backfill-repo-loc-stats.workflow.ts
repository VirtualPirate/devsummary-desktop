// workflows/backfill-repo-loc-stats.workflow.ts
import { slow } from './activity-proxies';
import { continueAsNew, sleep } from '@temporalio/workflow';

export async function BackfillRepoLocStatsWorkflow(input: {
  repositoryId: string;
  cursor: string | null;
}): Promise<void> {
  const { nextCursor } = await slow['loc.pageRepo'](input);
  if (nextCursor !== null) {
    await sleep('5s'); // mirrors REQUEUE_DELAY_SECONDS
    await continueAsNew<typeof BackfillRepoLocStatsWorkflow>({
      repositoryId: input.repositoryId,
      cursor: nextCursor,
    });
  }
}
