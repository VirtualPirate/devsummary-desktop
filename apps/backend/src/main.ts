// Default the process zone to UTC. The `auth` schema stores naive `timestamp`
// columns (migrations/00001_init.ts) that only round-trip consistently while
// every process shares one zone. Cadence math does not depend on this: it
// resolves every wall clock in the schedule's own zone. Overridable via TZ.
process.env.TZ ??= 'UTC';

import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';

/** Present only when Electron forked us via `utilityProcess.fork`. */
type ParentPort = { postMessage(message: unknown): void };

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);

  // Loopback only — the port must never be reachable from the LAN. Port 0 asks
  // the OS for a free one, which is why the bound port is read back below
  // rather than assumed.
  await app.listen(process.env.PORT ?? 0, '127.0.0.1');

  // Electron's main process has no other way to learn the OS-assigned port.
  const server = app.getHttpServer() as Server;
  const address = server.address() as AddressInfo | null;
  const parentPort = (process as { parentPort?: ParentPort }).parentPort;
  parentPort?.postMessage({ port: address?.port });
}
void bootstrap();
