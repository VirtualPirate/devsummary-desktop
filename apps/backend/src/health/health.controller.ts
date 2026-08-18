import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import type {
  ApiResponse,
  HealthResponse,
  LivenessResponse,
} from '@launchstack/api-interfaces';
import { HealthService } from './health.service';

@Controller('api/health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Readiness. 200 when every dependency answers, 503 when any does not, so
   * `curl -f` and orchestrator probes work off the status code while humans get
   * the per-dependency detail in the body.
   *
   * `passthrough: true` lets Nest keep serializing the returned object while we
   * choose the status code, which a plain return value cannot express.
   */
  @Get()
  @AllowAnonymous()
  async readiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResponse<HealthResponse>> {
    const data = await this.health.readiness();
    const healthy = data.status === 'ok';

    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      data,
      message: healthy ? 'OK' : 'Degraded',
      success: healthy,
    };
  }

  /**
   * Liveness. Always 200 while the process can serve HTTP. Point container
   * restart policies here, never at readiness — otherwise a brief Postgres
   * outage restarts a perfectly healthy API.
   */
  @Get('live')
  @AllowAnonymous()
  liveness(): ApiResponse<LivenessResponse> {
    return {
      data: this.health.liveness(),
      message: 'OK',
      success: true,
    };
  }
}
