import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { z } from 'zod';
import { TemporalProducerService, WORKFLOW } from '../temporal';

const Body$ = z.object({ message: z.string().min(1) });

@Controller('api/_internal/queue')
@AllowAnonymous()
export class NoopController {
  constructor(
    private readonly temporal: TemporalProducerService,
    private readonly config: ConfigService,
  ) {}

  @Post('noop')
  async trigger(
    @Headers('x-internal-token') token: string | undefined,
    @Body() rawBody: unknown,
  ): Promise<{ data: { jobId: string }; message: string; success: true }> {
    const expected = this.config.getOrThrow<string>('INTERNAL_API_TOKEN');
    if (!token || token !== expected) {
      throw new UnauthorizedException();
    }
    const body = Body$.parse(rawBody);
    const jobId = await this.temporal.start(WORKFLOW.noop, {
      args: [body.message],
    });
    return { data: { jobId }, message: 'enqueued', success: true };
  }
}
