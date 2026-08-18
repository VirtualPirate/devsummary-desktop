import { Injectable, Logger } from '@nestjs/common';
import { Activity } from '../../../../temporal';
import { CollaboratorSyncService } from '../services/collaborator-sync.service';

@Injectable()
export class CollaboratorActivities {
  private readonly logger = new Logger(CollaboratorActivities.name);

  constructor(private readonly sync: CollaboratorSyncService) {}

  @Activity('collaborators.syncRepo')
  async syncRepo(input: {
    repositoryId: string;
    trigger: 'connected' | 'disconnected' | 'webhook' | 'manual';
  }): Promise<void> {
    this.logger.log(
      `[collaborators.syncRepo] repo=${input.repositoryId} trigger=${input.trigger}`,
    );
    await this.sync.syncRepo(input.repositoryId, input.trigger);
  }
}
