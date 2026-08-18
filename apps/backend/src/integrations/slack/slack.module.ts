import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { AppError } from '../../common/errors';
import { KYSELY_DB, type AppDatabase } from '../../databases/kysely';
import { BriefSchedulesRepository } from '../../briefs/schedules/repositories/brief-schedules.repository';
import { SlackInstallationsController } from './controllers/installations.controller';
import { SlackMessagesController } from './controllers/messages.controller';
import { SlackInstallationsRepository } from './repositories/installations.repository';
import { SlackInstallationsService } from './services/installations.service';
import { SlackMessagesService } from './services/messages.service';
import { StateTokenService } from './services/state-token.service';
import { SlackClient } from './slack.client';
import { loadSlackConfig, type SlackConfig } from './slack.config';
import { SLACK_CONFIG_TOKEN } from './tokens';

function makeNotConfiguredStub(): SlackClient {
  const reject = () => Promise.reject(AppError.SLACK_NOT_CONFIGURED());
  return {
    generateAuthUri: () => {
      throw AppError.SLACK_NOT_CONFIGURED();
    },
    exchangeCodeForToken: reject,
    revokeToken: reject,
    postMessage: reject,
    getChannels: reject,
    getMembers: reject,
    joinChannel: reject,
  } as unknown as SlackClient;
}

@Module({
  controllers: [SlackInstallationsController, SlackMessagesController],
  providers: [
    {
      provide: SLACK_CONFIG_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => loadSlackConfig(config),
    },
    {
      provide: SlackClient,
      inject: [SLACK_CONFIG_TOKEN],
      useFactory: (cfg: SlackConfig | null) =>
        cfg ? new SlackClient(cfg) : makeNotConfiguredStub(),
    },
    {
      provide: StateTokenService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new StateTokenService(config.getOrThrow<string>('BETTER_AUTH_SECRET')),
    },
    {
      provide: SlackInstallationsService,
      inject: [
        SlackInstallationsRepository,
        StateTokenService,
        SlackClient,
        SLACK_CONFIG_TOKEN,
        KYSELY_DB,
        BriefSchedulesRepository,
      ],
      useFactory: (
        installs: SlackInstallationsRepository,
        stateToken: StateTokenService,
        client: SlackClient,
        cfg: SlackConfig | null,
        db: AppDatabase,
        briefSchedules: BriefSchedulesRepository,
      ) =>
        new SlackInstallationsService(
          installs,
          stateToken,
          client,
          cfg,
          db,
          briefSchedules,
        ),
    },
    SlackInstallationsRepository,
    // Provided here rather than imported from BriefsModule, which already
    // imports this module — importing it back would be a cycle. The repository
    // is a stateless wrapper over the global KYSELY_DB, so a second instance
    // costs nothing.
    BriefSchedulesRepository,
    SlackMessagesService,
  ],
  exports: [SlackClient, SlackInstallationsRepository, SlackMessagesService],
})
export class SlackIntegrationsModule implements NestModule {
  // The global body parser is off for Better Auth, so a controller with a
  // `@Body()` reads `undefined` without this. `POST /messages` has had one since
  // it was written — the test-message button is the first caller to exercise it.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(express.json()).forRoutes(SlackMessagesController);
  }
}
