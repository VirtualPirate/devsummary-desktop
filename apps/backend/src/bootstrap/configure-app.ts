import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';

/**
 * Everything the running application needs beyond AppModule itself.
 *
 * Shared by src/main.ts and the e2e harness so tests exercise the same
 * configuration production runs — most importantly the global exception
 * filter, without which error responses do not use the ApiError envelope.
 */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  app.enableCors({
    origin: true, // Accept requests from everywhere
    credentials: true,
  });
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));
  app.enableShutdownHooks();
}
