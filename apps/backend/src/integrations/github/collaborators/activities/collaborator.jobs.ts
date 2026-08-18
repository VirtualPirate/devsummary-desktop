import { Injectable, type OnModuleInit } from '@nestjs/common';
import { JOB, JobHandlerRegistry } from '../../../../jobs';
import type { SyncTrigger } from '../services/collaborator-sync.service';
import { CollaboratorActivities } from './collaborator.activities';

export interface SyncRepoCollaboratorsInput {
  repositoryId: string;
  trigger: SyncTrigger;
  organizationId?: string;
}

/** `SyncRepoCollaboratorsWorkflow` — one activity, no orchestration. */
@Injectable()
export class CollaboratorJobs implements OnModuleInit {
  constructor(
    private readonly activities: CollaboratorActivities,
    private readonly registry: JobHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.syncRepoCollaborators, (args) =>
      this.syncRepo(args as unknown as SyncRepoCollaboratorsInput),
    );
  }

  async syncRepo(input: SyncRepoCollaboratorsInput): Promise<void> {
    await this.activities.syncRepo({
      repositoryId: input.repositoryId,
      trigger: input.trigger,
    });
  }
}
