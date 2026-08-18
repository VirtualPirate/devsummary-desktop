import { Global, Module } from '@nestjs/common';
import { JobHandlerRegistry } from './job-handlers';
import { JobQueueService } from './job-queue.service';
import { JobRunnerService } from './job-runner.service';
import { SchedulerService } from './scheduler.service';

/**
 * The local job queue — Temporal's replacement. Global, like `TemporalModule`
 * was, so the ~6 call sites that used to inject `TemporalProducerService` only
 * swap the type name.
 *
 * Must be registered **after** `KyselyModule` in `app.module.ts`: the runner's
 * crash recovery and the scheduler's first sweep both query on `onModuleInit`,
 * and `KyselyModule` applies the migrations in its own.
 */
@Global()
@Module({
  providers: [
    JobHandlerRegistry,
    JobQueueService,
    JobRunnerService,
    SchedulerService,
  ],
  exports: [JobHandlerRegistry, JobQueueService],
})
export class JobsModule {}
