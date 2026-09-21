import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { LlmClient, LiveLlmClient } from '../common/llm';
import { GithubIntegrationsModule } from '../integrations/github';
import { GithubCollaboratorsModule } from '../integrations/github/collaborators/collaborators.module';
import { CommitAnalysisModule } from '../integrations/github/commit-analysis/commit-analysis.module';
import { BRIEFS_CONFIG_TOKEN } from './tokens';
import { loadBriefsConfig, type BriefsConfig } from './briefs-config';

import { ProjectsController } from './projects/controllers/projects.controller';
import { ProjectsService } from './projects/services/projects.service';
import { ProjectsRepository } from './projects/repositories/projects.repository';
import { ProjectRepositoriesRepository } from './projects/repositories/project-repositories.repository';

import { TeamsController } from './teams/controllers/teams.controller';
import { TeamsService } from './teams/services/teams.service';
import { TeamsRepository } from './teams/repositories/teams.repository';
import { TeamCollaboratorsRepository } from './teams/repositories/team-collaborators.repository';

import { BriefSchedulesController } from './schedules/controllers/brief-schedules.controller';
import { BriefSchedulesService } from './schedules/services/brief-schedules.service';
import { BriefSchedulesRepository } from './schedules/repositories/brief-schedules.repository';
import { CadenceService } from './schedules/services/cadence.service';

import { BriefsController } from './generation/controllers/briefs.controller';
import { BriefsService } from './generation/services/briefs.service';
import { BriefReportService } from './generation/services/brief-report.service';
import { BriefsRepository } from './generation/repositories/briefs.repository';
import { BriefCommitsRepository } from './generation/repositories/brief-commits.repository';
import { BriefReportRepository } from './generation/repositories/brief-report.repository';
import { BriefScopeResolver } from './generation/services/brief-scope.resolver';
import { BriefGeneratorService } from './generation/services/brief-generator.service';
import { BriefActivities } from './generation/activities/brief.activities';
import { BriefJobs } from './generation/activities/brief.jobs';

import { BriefDesktopService } from './delivery/services/brief-desktop.service';
import { BriefDelivererService } from './delivery/services/brief-deliverer.service';

@Module({
  imports: [
    GithubIntegrationsModule,
    GithubCollaboratorsModule,
    CommitAnalysisModule,
  ],
  controllers: [
    ProjectsController,
    TeamsController,
    BriefSchedulesController,
    BriefsController,
  ],
  providers: [
    {
      provide: BRIEFS_CONFIG_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => loadBriefsConfig(config),
    },
    {
      provide: LlmClient,
      // No not-configured stub decided at boot: `LiveLlmClient` re-resolves the
      // config on every call, so the provider, the key and the model are
      // whatever the settings screen last wrote — and an unset key becomes the
      // rejecting `UnconfiguredLlmClient` for that call only.
      inject: [BRIEFS_CONFIG_TOKEN],
      useFactory: (cfg: BriefsConfig) => new LiveLlmClient(() => cfg.llm),
    },

    ProjectsRepository,
    ProjectRepositoriesRepository,
    ProjectsService,

    TeamsRepository,
    TeamCollaboratorsRepository,
    TeamsService,

    BriefSchedulesRepository,
    CadenceService,
    BriefSchedulesService,

    BriefsRepository,
    BriefCommitsRepository,
    BriefReportRepository,
    BriefScopeResolver,
    BriefGeneratorService,
    BriefsService,
    BriefReportService,
    BriefActivities,
    BriefJobs,

    BriefDesktopService,
    BriefDelivererService,
  ],
})
export class BriefsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(express.json())
      .forRoutes(
        ProjectsController,
        TeamsController,
        BriefSchedulesController,
        BriefsController,
      );
  }
}
