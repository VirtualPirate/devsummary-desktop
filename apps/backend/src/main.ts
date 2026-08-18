// Default the process zone to UTC. The `auth` schema stores naive `timestamp`
// columns on purpose (migrations/00001_init.ts) — Better Auth only round-trips
// them consistently while every process shares one zone, and the API and the
// worker both boot AppAuthModule, so a deploy where their TZ differs shifts
// session/OTP expiry. Cadence math no longer depends on this: it resolves every
// wall clock in the schedule's own zone. Overridable via the TZ env var.
process.env.TZ ??= 'UTC';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  configureApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
