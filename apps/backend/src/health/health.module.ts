import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Public liveness/readiness endpoints (`GET /api/health`, `GET /api/health/live`).
 *
 * Depends only on the two global providers (KYSELY_DB from KyselyModule,
 * TEMPORAL_CLIENT from TemporalModule), so there is nothing to import here.
 * Both routes are @AllowAnonymous and neither is org-scoped, so the global
 * OrgContextGuard stays inert (it only engages on @RequireOrgRole routes).
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
