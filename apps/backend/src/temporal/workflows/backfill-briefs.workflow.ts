// workflows/backfill-briefs.workflow.ts
import { slow } from './activity-proxies';
import { startChild, ParentClosePolicy } from '@temporalio/workflow';
import { GenerateBriefWorkflow } from './generate-brief.workflow';
import { buildSearchAttributes } from '../search-attributes';

export async function BackfillBriefsWorkflow(input: {
  scheduleId: string;
  organizationId?: string;
  /** Months of history to fill. Omitted (executions started before this field
   * existed) falls back to the `BRIEFS_BACKFILL_MAX_BRIEFS` window. */
  backfillMonths?: number;
}): Promise<void> {
  const { briefs } = await slow['briefs.planBackfill']({
    scheduleId: input.scheduleId,
    backfillMonths: input.backfillMonths,
  });
  for (const b of briefs) {
    await startChild(GenerateBriefWorkflow, {
      args: [
        {
          briefId: b.briefId,
          deliver: false,
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
