import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Public liveness/readiness endpoints (`GET /api/health`, `GET /api/health/live`).
 *
 * Depends only on the global KYSELY_DB provider, so there is nothing to import
 * here. Both routes are allow-listed by path in LocalTokenGuard and neither is
 * org-scoped, so the global OrgContextGuard stays inert (it only engages on
 * @RequireOrgRole routes).
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
