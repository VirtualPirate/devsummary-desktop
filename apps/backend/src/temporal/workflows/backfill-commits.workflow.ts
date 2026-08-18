import { ingest } from './activity-proxies';
export async function BackfillCommitsWorkflow(input: {
  repositoryId: string;
  branch: string;
  sinceISO: string;
  organizationId?: string;
}): Promise<void> {
  await ingest['commits.backfill']({
    repositoryId: input.repositoryId,
    branch: input.branch,
    sinceISO: input.sinceISO,
  });
}
