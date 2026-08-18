import { Module } from '@nestjs/common';
import { GithubIntegrationsModule } from '../github.module';
import { CollaboratorActivities } from './activities/collaborator.activities';
import { GithubCollaboratorsController } from './controllers/collaborators.controller';
import { OrgCollaboratorsController } from './controllers/org-collaborators.controller';
import { CollaboratorsRepository } from './repositories/collaborators.repository';
import { RepositoryCollaboratorsRepository } from './repositories/repository-collaborators.repository';
import { CollaboratorSyncService } from './services/collaborator-sync.service';

@Module({
  imports: [GithubIntegrationsModule],
  controllers: [GithubCollaboratorsController, OrgCollaboratorsController],
  providers: [
    CollaboratorsRepository,
    RepositoryCollaboratorsRepository,
    CollaboratorSyncService,
    CollaboratorActivities,
  ],
  exports: [
    CollaboratorsRepository,
    RepositoryCollaboratorsRepository,
    CollaboratorSyncService,
  ],
})
export class GithubCollaboratorsModule {}
