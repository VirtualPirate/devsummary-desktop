import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { buildPinoConfig } from './pino.config';

@Module({
  imports: [PinoLoggerModule.forRoot(buildPinoConfig())],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
