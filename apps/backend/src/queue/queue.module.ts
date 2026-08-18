import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import * as express from 'express';
import { NoopActivity } from './noop.activity';
import { NoopController } from './noop.controller';

@Module({
  controllers: [NoopController],
  providers: [NoopActivity],
})
export class QueueModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(express.json()).forRoutes(NoopController);
  }
}
