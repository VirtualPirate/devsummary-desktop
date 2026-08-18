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

  // CORS exists here for exactly one caller: the Vite dev server on :5173,
  // which is a different origin from the backend's loopback port. A packaged
  // build loads the renderer from `file://`, which sends no meaningful origin
  // and is not subject to CORS anyway — so production gets no CORS headers at
  // all rather than `origin: true`, which handed them to any page the user
  // happened to have open. The real boundary is `LocalTokenGuard`; this just
  // stops the browser from being a second way in.
  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({ origin: 'http://localhost:5173' });
  }
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));
  app.enableShutdownHooks();
}
