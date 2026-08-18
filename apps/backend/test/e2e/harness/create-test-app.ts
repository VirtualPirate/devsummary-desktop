import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Kysely } from 'kysely';
import type { Server } from 'node:http';
import type { Database } from '../../../src/databases/kysely/database.types';

export interface TestApp {
  app: INestApplication;
  server: Server;
  /** Closes the app *and* the PGlite instance behind it (KyselyModule owns it). */
  close: () => Promise<void>;
}

/**
 * Boot the real AppModule against the file's in-memory PGlite.
 *
 * The database is injected rather than built by the app: an in-memory PGlite
 * lives inside one instance, so the harness and the app have to share the same
 * object or they would see two empty, unrelated databases. Overriding the
 * `KYSELY_DB` token is the whole mechanism — everything else (migrations at
 * boot, the job runner, the scheduler, both global guards) runs untouched.
 *
 * Imports are dynamic and deliberately inside the function: the module graph
 * must not load until the calling file's `beforeAll` has set its env.
 */
export async function createTestApp(db: Kysely<Database>): Promise<TestApp> {
  const { AppModule } = await import('../../../src/app.module');
  const { configureApp } = await import('../../../src/bootstrap/configure-app');
  const { KYSELY_DB } =
    await import('../../../src/databases/kysely/kysely.token');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(KYSELY_DB)
    .useValue(db)
    .compile();

  // Body parsing is on: Better Auth was the only reason main.ts ever disabled it.
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return {
    app,
    server: app.getHttpServer() as Server,
    close: () => app.close(),
  };
}
