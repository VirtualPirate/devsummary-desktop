import {
  Global,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import * as express from 'express';
import { AgentCliDetector, agentCliDetector } from '../../common/llm';
import { SlackIntegrationsModule } from '../../integrations/slack';
import { LocalSettingsController } from './local-settings.controller';
import { LocalSettingsRepository } from './local-settings.repository';
import { LocalSettingsService } from './local-settings.service';
import { SecretsService } from './secrets.service';

/**
 * Global because the secret bundle is process-wide state, not a feature: the
 * Slack repository (token encryption) and the desktop notifier both need it,
 * and neither should have to import a settings module to send a message.
 */
@Global()
@Module({
  imports: [SlackIntegrationsModule],
  controllers: [LocalSettingsController],
  providers: [
    SecretsService,
    LocalSettingsRepository,
    LocalSettingsService,
    // The same process-wide singleton `createLlmClient` uses, registered here
    // only so the settings service can be unit-tested with a stub. `BriefsModule`
    // and `CommitAnalysisModule` still reach it directly — threading a provider
    // through three module graphs buys nothing over one cache.
    { provide: AgentCliDetector, useValue: agentCliDetector },
  ],
  exports: [SecretsService, LocalSettingsRepository],
})
export class LocalSettingsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(express.json()).forRoutes(LocalSettingsController);
  }
}
