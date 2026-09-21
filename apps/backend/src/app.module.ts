import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { KyselyModule } from './databases/kysely';
import { LocalSessionMiddleware, LocalTokenGuard } from './local';
import { LocalSettingsModule } from './local/settings/local-settings.module';
import { OrganizationsModule } from './organizations';
import { GithubIntegrationsModule } from './integrations/github';
import { CommitAnalysisModule } from './integrations/github/commit-analysis/commit-analysis.module';
import { GithubCollaboratorsModule } from './integrations/github/collaborators/collaborators.module';
import { BriefsModule } from './briefs';
import { AnalyticsModule } from './analytics/analytics.module';
import { AgentsModule } from './agents';
import { CommitsModule } from './commits/commits.module';
import { JobActivityModule } from './jobs-activity/job-activity.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs';
import { LoggerModule, RequestIdMiddleware } from './logger';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    KyselyModule,
    // After KyselyModule, never before: the runner's crash recovery and the
    // scheduler's first sweep query on onModuleInit, and KyselyModule applies
    // the migrations in its own.
    JobsModule,
    // @Global: SecretsService + LocalSettingsRepository resolve everywhere
    // (the GitHub credential store and BriefDesktopService both need them).
    LocalSettingsModule,
    OrganizationsModule,
    GithubIntegrationsModule,
    CommitAnalysisModule,
    GithubCollaboratorsModule,
    BriefsModule,
    AnalyticsModule,
    // After AnalyticsModule: it imports AnalyticsService and
    // CollaboratorsRepository from their modules.
    AgentsModule,
    CommitsModule,
    JobActivityModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Root-module APP_GUARD, so Nest's scan order puts it ahead of
    // OrganizationsModule's OrgContextGuard: the loopback token is checked
    // before anything reads the org header or touches the database.
    { provide: APP_GUARD, useClass: LocalTokenGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, LocalSessionMiddleware).forRoutes('*');
  }
}
