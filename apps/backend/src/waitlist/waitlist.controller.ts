import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { ApiResponse } from '@launchstack/api-interfaces';
import { z } from 'zod';
import { ZodValidationPipe } from '../organizations/dto';
import { WaitlistRateLimitGuard } from './waitlist-rate-limit.guard';
import { WaitlistService } from './waitlist.service';

export const JoinWaitlistSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

type JoinWaitlistRequest = z.infer<typeof JoinWaitlistSchema>;

@Controller('api/waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  // The guard runs before the pipe, so a flood costs no validation either.
  @Post()
  @AllowAnonymous()
  @UseGuards(WaitlistRateLimitGuard)
  async join(
    @Body(new ZodValidationPipe(JoinWaitlistSchema))
    body: JoinWaitlistRequest,
  ): Promise<ApiResponse<null>> {
    await this.waitlist.join(body.email);
    return { data: null, message: "You're on the list", success: true };
  }
}
