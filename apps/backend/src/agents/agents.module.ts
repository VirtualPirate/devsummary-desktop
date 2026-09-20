import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AnalyticsService } from '../analytics/services/analytics.service';
import { KYSELY_DB, type AppDatabase } from '../databases/kysely';
import { GithubCollaboratorsModule } from '../integrations/github/collaborators/collaborators.module';
import { CollaboratorsRepository } from '../integrations/github/collaborators/repositories/collaborators.repository';
import { OrganizationsModule } from '../organizations';
import {
  AGENTS_CONFIG,
  loadAgentsConfig,
  type AgentsConfig,
} from './agents.config';
import { AgentThreadsController } from './controllers/agent-threads.controller';
import { AgentDataRepository } from './repositories/agent-data.repository';
import { AgentSessionsRepository } from './repositories/agent-sessions.repository';
import { AgentUsageRepository } from './repositories/agent-usage.repository';
import { AgentGraphService } from './services/agent-graph.service';
import { AgentUsageService } from './services/agent-usage.service';

/**
 * No enable flag: the agent is available whenever an LLM provider is
 * configured, and an unconfigured one surfaces as `OPENAI_NOT_CONFIGURED` on the
 * first run rather than as a missing menu item. Nothing here reaches a provider
 * or opens a checkpointer until a run asks it to.
 */
@Module({
  imports: [OrganizationsModule, GithubCollaboratorsModule, AnalyticsModule],
  controllers: [AgentThreadsController],
  providers: [
    {
      provide: AGENTS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AgentsConfig =>
        loadAgentsConfig(config),
    },
    {
      provide: AgentGraphService,
      inject: [
        AGENTS_CONFIG,
        AgentDataRepository,
        CollaboratorsRepository,
        AnalyticsService,
        KYSELY_DB,
      ],
      useFactory: (
        config: AgentsConfig,
        data: AgentDataRepository,
        collaborators: CollaboratorsRepository,
        analytics: AnalyticsService,
        db: AppDatabase,
      ) => new AgentGraphService(config, data, collaborators, analytics, db),
    },
    {
      provide: AgentUsageService,
      inject: [AgentUsageRepository, AGENTS_CONFIG],
      useFactory: (usage: AgentUsageRepository, config: AgentsConfig) =>
        new AgentUsageService(usage, config),
    },
    AgentDataRepository,
    AgentSessionsRepository,
    AgentUsageRepository,
  ],
})
export class AgentsModule {}
