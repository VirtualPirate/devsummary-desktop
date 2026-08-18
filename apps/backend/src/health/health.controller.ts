import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
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
   * Liveness. Always 200 while the process can serve HTTP. Point the Electron
   * main process's restart logic here, never at readiness — otherwise a brief
   * database stall restarts a perfectly healthy backend.
   *
   * Both routes are reachable without the per-boot token: `LocalTokenGuard`
   * allow-lists `/api/health` by path, which is what the `@AllowAnonymous()`
   * decorator from the deleted auth wrapper used to do.
   */
  @Get('live')
  liveness(): ApiResponse<LivenessResponse> {
    return {
      data: this.health.liveness(),
      message: 'OK',
      success: true,
    };
  }
}
