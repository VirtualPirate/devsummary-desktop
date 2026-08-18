import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import * as express from 'express';
import { BriefSchedulesRepository } from '../../briefs/schedules/repositories/brief-schedules.repository';
import { SlackInstallationsController } from './controllers/installations.controller';
import { SlackMessagesController } from './controllers/messages.controller';
import { SlackInstallationsRepository } from './repositories/installations.repository';
import { SlackInstallationsService } from './services/installations.service';
import { SlackMessagesService } from './services/messages.service';
import { SlackClient } from './slack.client';

@Module({
  controllers: [SlackInstallationsController, SlackMessagesController],
  providers: [
    // No graceful-degradation stub any more: the client carries no server-side
    // configuration at all, and "not configured" now means "no installation
    // row", which every read path already reports as
    // SLACK_INSTALLATION_NOT_FOUND.
    SlackClient,
    SlackInstallationsService,
    SlackInstallationsRepository,
    // Provided here rather than imported from BriefsModule, which already
    // imports this module — importing it back would be a cycle. The repository
    // is a stateless wrapper over the global KYSELY_DB, so a second instance
    // costs nothing.
    BriefSchedulesRepository,
    SlackMessagesService,
  ],
  exports: [
    SlackClient,
    SlackInstallationsRepository,
    SlackInstallationsService,
    SlackMessagesService,
  ],
})
export class SlackIntegrationsModule implements NestModule {
  // The global body parser is off for Better Auth, so a controller with a
  // `@Body()` reads `undefined` without this. `POST /messages` has had one since
  // it was written; `POST /installations/token` needs the same.
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(express.json())
      .forRoutes(SlackMessagesController, SlackInstallationsController);
  }
}
