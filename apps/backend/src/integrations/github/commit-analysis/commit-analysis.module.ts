import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmClient, LiveLlmClient } from '../../../common/llm';
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
      // No not-configured stub decided at boot: `LiveLlmClient` re-resolves the
      // config on every call, so the provider, the key and the model are
      // whatever the settings screen last wrote — and an unset key becomes the
      // rejecting `UnconfiguredLlmClient` for that call only.
      provide: LlmClient,
      inject: [COMMIT_ANALYSIS_CONFIG_TOKEN],
      useFactory: (cfg: CommitAnalysisConfig) =>
        new LiveLlmClient(() => cfg.llm),
    },
    {
      provide: CommitAnalyzerService,
      inject: [LlmClient, COMMIT_ANALYSIS_CONFIG_TOKEN],
      useFactory: (llm: LlmClient, cfg: CommitAnalysisConfig) =>
        new CommitAnalyzerService(llm, cfg),
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
