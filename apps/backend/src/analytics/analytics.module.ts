import { Module } from '@nestjs/common';
import { GithubCollaboratorsModule } from '../integrations/github/collaborators/collaborators.module';
import { AnalyticsController } from './controllers/analytics.controller';
import { CommitActivityRepository } from './repositories/commit-activity.repository';
import { AnalyticsService } from './services/analytics.service';

@Module({
  imports: [GithubCollaboratorsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, CommitActivityRepository],
  // AgentsModule's tools route their bucketing through the same service the
  // dashboard uses — a second implementation is how a report came to disagree
  // with its own brief.
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
