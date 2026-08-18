import { Module } from '@nestjs/common';
import { GithubCollaboratorsModule } from '../integrations/github/collaborators/collaborators.module';
import { AnalyticsController } from './controllers/analytics.controller';
import { CommitActivityRepository } from './repositories/commit-activity.repository';
import { AnalyticsService } from './services/analytics.service';

@Module({
  imports: [GithubCollaboratorsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, CommitActivityRepository],
})
export class AnalyticsModule {}
