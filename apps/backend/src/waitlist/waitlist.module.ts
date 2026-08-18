import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import * as express from 'express';
import { WaitlistController } from './waitlist.controller';
import { WaitlistRateLimitGuard } from './waitlist-rate-limit.guard';
import { WaitlistService } from './waitlist.service';

/**
 * Public `POST /api/waitlist`. Body parsing is opt-in per controller (the
 * global parser is off for Better Auth), hence the `express.json()` below.
 */
@Module({
  controllers: [WaitlistController],
  // The guard is a provider so the request counter is one shared singleton.
  providers: [WaitlistRateLimitGuard, WaitlistService],
})
export class WaitlistModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(express.json()).forRoutes(WaitlistController);
  }
}
