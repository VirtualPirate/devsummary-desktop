// workflows/generate-brief.workflow.ts
import { standard } from './activity-proxies';
export async function GenerateBriefWorkflow(input: {
  briefId: string;
  deliver?: boolean;
  organizationId?: string;
}): Promise<void> {
  const { proceed } = await standard['briefs.markGenerating']({
    briefId: input.briefId,
  });
  if (!proceed) return;
  const { terminal } = await standard['briefs.generateContent']({
    briefId: input.briefId,
  });
  if (terminal) return;
  if (input.deliver === false) return;
  await standard['briefs.deliver']({ briefId: input.briefId });
}
