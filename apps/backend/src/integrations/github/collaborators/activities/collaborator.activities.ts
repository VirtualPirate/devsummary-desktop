import { Injectable, Logger } from '@nestjs/common';
import { CollaboratorSyncService } from '../services/collaborator-sync.service';

@Injectable()
export class CollaboratorActivities {
  private readonly logger = new Logger(CollaboratorActivities.name);

  constructor(private readonly sync: CollaboratorSyncService) {}

  async syncRepo(input: {
    repositoryId: string;
    trigger: 'connected' | 'disconnected' | 'manual';
  }): Promise<void> {
    this.logger.log(
      `[collaborators.syncRepo] repo=${input.repositoryId} trigger=${input.trigger}`,
    );
    await this.sync.syncRepo(input.repositoryId, input.trigger);
  }
}
