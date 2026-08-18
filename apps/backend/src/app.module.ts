import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { KyselyModule } from './databases/kysely';
import { AppAuthModule } from './auth';
import { OrganizationsModule } from './organizations';
import { GithubIntegrationsModule } from './integrations/github';
import { SlackIntegrationsModule } from './integrations/slack';
import { CommitAnalysisModule } from './integrations/github/commit-analysis/commit-analysis.module';
import { GithubCollaboratorsModule } from './integrations/github/collaborators/collaborators.module';
import { BriefsModule } from './briefs';
import { AnalyticsModule } from './analytics/analytics.module';
import { JobActivityModule } from './jobs-activity/job-activity.module';
import { HealthModule } from './health/health.module';
import { QueueModule } from './queue/queue.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { TemporalModule } from './temporal';
import { LoggerModule, RequestIdMiddleware } from './logger';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    KyselyModule,
    TemporalModule.forRoot(),
    AppAuthModule,
    OrganizationsModule,
    GithubIntegrationsModule,
    SlackIntegrationsModule,
    CommitAnalysisModule,
    GithubCollaboratorsModule,
    BriefsModule,
    AnalyticsModule,
    JobActivityModule,
    HealthModule,
    QueueModule,
    WaitlistModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
