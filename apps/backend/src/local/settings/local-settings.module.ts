import {
  Global,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import * as express from 'express';
import { AgentCliDetector, agentCliDetector } from '../../common/llm';
import { EmailVerificationService } from './email-verification.service';
import { LocalSettingsController } from './local-settings.controller';
import { LocalSettingsRepository } from './local-settings.repository';
import { LocalSettingsService } from './local-settings.service';
import { SecretsService } from './secrets.service';

/**
 * Global because the secret bundle is process-wide state, not a feature: the
 * GitHub credential store (token encryption) and the desktop notifier both need
 * it, and neither should have to import a settings module to use it.
 */
@Global()
@Module({
  controllers: [LocalSettingsController],
  providers: [
    SecretsService,
    LocalSettingsRepository,
    LocalSettingsService,
    EmailVerificationService,
    // The same process-wide singleton `createLlmClient` uses, registered here
    // only so the settings service can be unit-tested with a stub. `BriefsModule`
    // and `CommitAnalysisModule` still reach it directly — threading a provider
    // through three module graphs buys nothing over one cache.
    { provide: AgentCliDetector, useValue: agentCliDetector },
  ],
  // Exported because the repository cap it gates is enforced in the GitHub
  // module — this module is @Global, so that stays one import-free injection.
  exports: [SecretsService, LocalSettingsRepository, EmailVerificationService],
})
export class LocalSettingsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(express.json()).forRoutes(LocalSettingsController);
  }
}
