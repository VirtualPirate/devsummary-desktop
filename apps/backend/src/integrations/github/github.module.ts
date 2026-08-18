import { Module, type MiddlewareConsumer } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { KYSELY_DB, type AppDatabase } from '../../databases/kysely';
import { AppError } from '../../common/errors';
import { TemporalProducerService } from '../../temporal';
import { GithubInstallationsController } from './controllers/installations.controller';
import { GithubRepositoriesController } from './controllers/repositories.controller';
import { GithubWebhooksController } from './controllers/webhooks.controller';
import { GithubAppClient } from './github-app.client';
import { loadGithubAppConfig } from './github-app.config';
import { IngestStatusRepository } from './repositories/ingest-status.repository';
import { GithubInstallationsRepository } from './repositories/installations.repository';
import { GithubRepositoriesRepository } from './repositories/repositories.repository';
import { RepositoryBranchesRepository } from './repositories/repository-branches.repository';
import { GithubWebhookEventsRepository } from './repositories/webhook-events.repository';
import { IngestStatusService } from './services/ingest-status.service';
import { GithubInstallationsService } from './services/installations.service';
import { RepositoryBranchesService } from './services/repository-branches.service';
import { StateTokenService } from './services/state-token.service';
import { WebhookVerifierService } from './services/webhook-verifier.service';
import { GITHUB_APP_CONFIG_TOKEN } from './tokens';

@Module({
  controllers: [
    GithubInstallationsController,
    GithubRepositoriesController,
    GithubWebhooksController,
  ],
  providers: [
    {
      provide: GITHUB_APP_CONFIG_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => loadGithubAppConfig(config),
    },
    {
      provide: GithubAppClient,
      inject: [GITHUB_APP_CONFIG_TOKEN],
      useFactory: (cfg: ReturnType<typeof loadGithubAppConfig>) => {
        if (!cfg) {
          return {
            getInstallation: () =>
              Promise.reject(AppError.GITHUB_APP_NOT_CONFIGURED()),
            listInstallationRepos: () =>
              Promise.reject(AppError.GITHUB_APP_NOT_CONFIGURED()),
            deleteInstallation: () =>
              Promise.reject(AppError.GITHUB_APP_NOT_CONFIGURED()),
            listCommits: () =>
              Promise.reject(AppError.GITHUB_APP_NOT_CONFIGURED()),
            getCommit: () =>
              Promise.reject(AppError.GITHUB_APP_NOT_CONFIGURED()),
            listBranches: () =>
              Promise.reject(AppError.GITHUB_APP_NOT_CONFIGURED()),
            listRepoCollaborators: () =>
              Promise.reject(AppError.GITHUB_APP_NOT_CONFIGURED()),
          };
        }
        return new GithubAppClient(cfg);
      },
    },
    {
      provide: StateTokenService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new StateTokenService(config.getOrThrow<string>('BETTER_AUTH_SECRET')),
    },
    {
      provide: GithubInstallationsService,
      inject: [
        GithubInstallationsRepository,
        GithubRepositoriesRepository,
        RepositoryBranchesRepository,
        StateTokenService,
        GithubAppClient,
        GITHUB_APP_CONFIG_TOKEN,
        KYSELY_DB,
        TemporalProducerService,
      ],
      useFactory: (
        installs: GithubInstallationsRepository,
        repos: GithubRepositoriesRepository,
        trackedBranches: RepositoryBranchesRepository,
        stateToken: StateTokenService,
        client: GithubAppClient,
        cfg: ReturnType<typeof loadGithubAppConfig>,
        db: AppDatabase,
        temporal: TemporalProducerService,
      ) =>
        new GithubInstallationsService(
          installs,
          repos,
          trackedBranches,
          stateToken,
          client,
          cfg,
          db,
          temporal,
        ),
    },
    RepositoryBranchesService,
    IngestStatusService,
    GithubInstallationsRepository,
    GithubRepositoriesRepository,
    RepositoryBranchesRepository,
    IngestStatusRepository,
    GithubWebhookEventsRepository,
    WebhookVerifierService,
  ],
  exports: [
    GithubAppClient,
    GithubInstallationsRepository,
    GithubRepositoriesRepository,
    RepositoryBranchesRepository,
  ],
})
export class GithubIntegrationsModule {
  /**
   * Only the repositories controller — the global body parser is off for Better
   * Auth, and the webhook controller must keep reading `req.rawBody` for its
   * HMAC check, so it is deliberately not listed here.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(express.json()).forRoutes(GithubRepositoriesController);
  }
}
