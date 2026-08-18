import { Module } from '@nestjs/common';
import { JobActivityController } from './job-activity.controller';
import { JobActivityService } from './job-activity.service';

/**
 * Read-only endpoint exposing live background-job activity to the frontend
 * (drives the "background jobs" loading toast). JobActivityService depends
 * on the global TEMPORAL_CLIENT provider (from TemporalModule); org
 * scoping/role checks come from the global OrgContextGuard.
 */
@Module({
  controllers: [JobActivityController],
  providers: [JobActivityService],
})
export class JobActivityModule {}
