import { Module, type MiddlewareConsumer } from '@nestjs/common';
import * as express from 'express';
import { GithubInstallationsController } from './controllers/installations.controller';
import { GithubRepositoriesController } from './controllers/repositories.controller';
import { openGithubToken } from './credentials';
import { SecretsService } from '../../local/settings/secrets.service';
import { GithubAppClient } from './github.client';
import { IngestStatusRepository } from './repositories/ingest-status.repository';
import { GithubInstallationsRepository } from './repositories/installations.repository';
import { GithubRepositoriesRepository } from './repositories/repositories.repository';
import { RepositoryBranchesRepository } from './repositories/repository-branches.repository';
import { IngestStatusService } from './services/ingest-status.service';
import { GithubInstallationsService } from './services/installations.service';
import { RepositoryBranchesService } from './services/repository-branches.service';

@Module({
  controllers: [GithubInstallationsController, GithubRepositoriesController],
  providers: [
    {
      // The credential is a stored row, not env, so there is no
      // not-configured stub any more: an unconnected install fails at token
      // resolution with the same `GITHUB_APP_NOT_CONFIGURED` the stub threw —
      // and now it covers *every* method, which the stub did not.
      provide: GithubAppClient,
      inject: [GithubInstallationsRepository, SecretsService],
      useFactory: (
        installs: GithubInstallationsRepository,
        secrets: SecretsService,
      ) =>
        new GithubAppClient(async (installationId) => {
          const row =
            await installs.findActiveByGithubInstallationId(installationId);
          return openGithubToken(row?.raw, secrets.encryptionKey());
        }),
    },
    GithubInstallationsService,
    RepositoryBranchesService,
    IngestStatusService,
    GithubInstallationsRepository,
    GithubRepositoriesRepository,
    RepositoryBranchesRepository,
    IngestStatusRepository,
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
   * The global body parser is off while Better Auth is still wired in; both
   * controllers take JSON bodies, so both need it applied here. Harmless once
   * the global parser comes back.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(express.json())
      .forRoutes(GithubInstallationsController, GithubRepositoriesController);
  }
}
