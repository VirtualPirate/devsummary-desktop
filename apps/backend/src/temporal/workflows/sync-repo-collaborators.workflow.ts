import { standard } from './activity-proxies';

export async function SyncRepoCollaboratorsWorkflow(input: {
  repositoryId: string;
  trigger: 'connected' | 'disconnected' | 'webhook' | 'manual';
  organizationId?: string;
}): Promise<void> {
  await standard['collaborators.syncRepo']({
    repositoryId: input.repositoryId,
    trigger: input.trigger,
  });
}
