import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GithubCollaboratorsModule } from '../collaborators/collaborators.module';
import { GithubIntegrationsModule } from '../github.module';
import { CommitAnalysisController } from './controllers/commit-analysis.controller';
import {
  loadCommitAnalysisConfig,
  type CommitAnalysisConfig,
} from './commit-analysis.config';
import { CommitAnalysisActivities } from './activities/commit-analysis.activities';
import { CommitAnalysisJobs } from './activities/commit-analysis.jobs';
import { LocStatsActivities } from './activities/loc-stats.activities';
import { CommitAnalysesRepository } from './repositories/commit-analyses.repository';
import { CommitsRepository } from './repositories/commits.repository';
import { CommitAnalyzerService } from './services/commit-analyzer.service';
import { CommitBackfillService } from './services/commit-backfill.service';
import { OpenAIClient } from './services/openai.client';
import { COMMIT_ANALYSIS_CONFIG_TOKEN } from './tokens';

@Module({
  // Collaborators for `CommitBackfillService`: commit authors are the source of
  // truth for who exists, so ingest writes into that table.
  imports: [GithubIntegrationsModule, GithubCollaboratorsModule],
  controllers: [CommitAnalysisController],
  providers: [
    {
      provide: COMMIT_ANALYSIS_CONFIG_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => loadCommitAnalysisConfig(config),
    },
    {
      // No not-configured stub: the config reads the key live, so "configured"
      // is a per-call question now. `OpenAIClient` throws
      // `OPENAI_NOT_CONFIGURED` itself when the key is still empty.
      provide: OpenAIClient,
      inject: [COMMIT_ANALYSIS_CONFIG_TOKEN],
      useFactory: (cfg: CommitAnalysisConfig) => new OpenAIClient(cfg),
    },
    {
      provide: CommitAnalyzerService,
      inject: [OpenAIClient, COMMIT_ANALYSIS_CONFIG_TOKEN],
      useFactory: (openai: OpenAIClient, cfg: CommitAnalysisConfig) =>
        new CommitAnalyzerService(openai, cfg),
    },
    CommitBackfillService,
    CommitsRepository,
    CommitAnalysesRepository,
    CommitAnalysisActivities,
    LocStatsActivities,
    CommitAnalysisJobs,
  ],
  exports: [CommitsRepository, CommitAnalysesRepository],
})
export class CommitAnalysisModule {}
