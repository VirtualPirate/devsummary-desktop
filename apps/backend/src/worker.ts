// Same pin as main.ts: the `auth` schema's naive `timestamp` columns only
// round-trip consistently while the API and this worker share one zone (both
// boot AppAuthModule), so a deploy where their TZ differs shifts session/OTP
// expiry. Cadence math is zone-independent now, so this is not what keeps
// schedules correct. Overridable via the TZ env var.
process.env.TZ ??= 'UTC';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { NativeConnection, Worker } from '@temporalio/worker';
import { AppModule } from './app.module';
import { buildTemporalConfig } from './temporal/temporal.config';
import { buildActivities } from './temporal/activity-registry';
import { ConfigService } from '@nestjs/config';

async function bootstrap(): Promise<void> {
  process.env.TEMPORAL_MANAGE_SCHEDULES = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const logger = app.get(Logger);

  const cfg = buildTemporalConfig(app.get(ConfigService));
  const activities = buildActivities(app);

  const connection = await NativeConnection.connect({ address: cfg.address });
  const worker = await Worker.create({
    connection,
    namespace: cfg.namespace,
    taskQueue: cfg.taskQueue,
    workflowsPath: require.resolve('./temporal/workflows'),
    activities,
    // Per-process limits. When the worker runs with replicas > 1 the effective ceiling is
    // replicas x these values, so they have to be tunable from the deployment.
    maxConcurrentActivityTaskExecutions: cfg.maxConcurrentActivities,
    maxConcurrentWorkflowTaskExecutions: cfg.maxConcurrentWorkflowTasks,
  });

  logger.log(
    `Temporal worker started: ${Object.keys(activities).length} activities on '${cfg.taskQueue}'`,
    'Worker',
  );

  const shutdown = () => worker.shutdown(); // signals drain; worker.run() resolves once drained
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  try {
    await worker.run();
  } finally {
    await app.close();
    await connection.close();
  }
}
void bootstrap();
