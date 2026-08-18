import {
  Global,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import * as express from 'express';
import { SlackIntegrationsModule } from '../../integrations/slack';
import { LocalSettingsController } from './local-settings.controller';
import { LocalSettingsRepository } from './local-settings.repository';
import { LocalSettingsService } from './local-settings.service';
import { SecretsService } from './secrets.service';

/**
 * Global because the secret bundle is process-wide state, not a feature: the
 * Slack repository (token encryption) and the brief email sender both need it,
 * and neither should have to import a settings module to send a message.
 */
@Global()
@Module({
  imports: [SlackIntegrationsModule],
  controllers: [LocalSettingsController],
  providers: [SecretsService, LocalSettingsRepository, LocalSettingsService],
  exports: [SecretsService, LocalSettingsRepository],
})
export class LocalSettingsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(express.json()).forRoutes(LocalSettingsController);
  }
}
