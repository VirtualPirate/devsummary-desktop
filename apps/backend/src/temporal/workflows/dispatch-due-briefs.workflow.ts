// workflows/dispatch-due-briefs.workflow.ts
import { once } from './activity-proxies';
import { startChild, ParentClosePolicy } from '@temporalio/workflow';
import { GenerateBriefWorkflow } from './generate-brief.workflow';
import { buildSearchAttributes } from '../search-attributes';

export async function DispatchDueBriefsWorkflow(): Promise<void> {
  const { briefs } = await once['briefs.claimDue']();
  for (const b of briefs) {
    await startChild(GenerateBriefWorkflow, {
      args: [
        {
          briefId: b.briefId,
          deliver: b.deliver,
          organizationId: b.organizationId,
        },
      ],
      parentClosePolicy: ParentClosePolicy.ABANDON,
      searchAttributes: buildSearchAttributes({
        organizationId: b.organizationId,
        phase: 'generating',
      }),
    });
  }
}
