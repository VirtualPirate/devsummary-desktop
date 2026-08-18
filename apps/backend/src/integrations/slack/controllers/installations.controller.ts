import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AllowAnonymous,
  OptionalAuth,
  Session,
} from '@thallesp/nestjs-better-auth';
import type { ApiResponse } from '@launchstack/api-interfaces';
import type { Request, Response } from 'express';
import { ApiException } from '../../../common/errors';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../../organizations/dto/zod-validation.pipe';
import {
  CallbackQuerySchema,
  InstallationIdParamSchema,
  type CallbackQuery,
} from '../dto/installations.dto';
import {
  SlackInstallationsService,
  type SlackInstallationView,
} from '../services/installations.service';

type SessionPayload = {
  user: { id: string; email: string; emailVerified: boolean };
};

@Controller('api/integrations/slack/installations')
export class SlackInstallationsController {
  constructor(
    private readonly svc: SlackInstallationsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @RequireOrgRole('admin')
  async list(
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<ApiResponse<SlackInstallationView[]>> {
    const data = await this.svc.listForOrg(membership.organizationId);
    return { data, message: 'OK', success: true };
  }

  @Post('start')
  @RequireOrgRole('admin')
  start(
    @OrgMembership() membership: OrgMembershipContext,
    @Session() session: SessionPayload,
  ): ApiResponse<{ installUrl: string }> {
    const installUrl = this.svc.buildInstallUrl({
      orgId: membership.organizationId,
      userId: session.user.id,
    });
    return { data: { installUrl }, message: 'OK', success: true };
  }

  @Get('callback')
  @AllowAnonymous()
  @OptionalAuth()
  async callback(
    @Query(new ZodValidationPipe(CallbackQuerySchema)) query: CallbackQuery,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');
    const successUrl = `${frontendUrl}/integrations/slack`;

    if (query.error) {
      res.redirect(
        302,
        `${successUrl}?error=${encodeURIComponent(query.error)}`,
      );
      return;
    }

    try {
      const sessionUserId =
        (req as unknown as { session?: { user?: { id?: string } } }).session
          ?.user?.id ?? null;

      await this.svc.handleCallback({
        state: query.state,
        code: query.code,
        sessionUserId,
      });

      res.redirect(302, `${successUrl}?connected=1`);
    } catch (err) {
      const code =
        err instanceof ApiException ? err.code : 'SLACK_CALLBACK_FAILED';
      res.redirect(302, `${successUrl}?error=${encodeURIComponent(code)}`);
    }
  }

  @Delete(':id')
  @RequireOrgRole('admin')
  @HttpCode(204)
  async disconnect(
    @OrgMembership() membership: OrgMembershipContext,
    @Param(new ZodValidationPipe(InstallationIdParamSchema))
    params: { id: string },
  ): Promise<void> {
    await this.svc.disconnect(membership.organizationId, params.id);
  }
}
