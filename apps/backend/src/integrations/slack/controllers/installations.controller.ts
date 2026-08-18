import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  SLACK_BOT_SCOPES,
  type ApiResponse,
} from '@launchstack/api-interfaces';
import { LOCAL_USER_ID } from '../../../local/local-identity';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../../organizations/dto/zod-validation.pipe';
import {
  ConnectTokenBodySchema,
  InstallationIdParamSchema,
  type ConnectTokenBody,
} from '../dto/installations.dto';
import {
  SlackInstallationsService,
  type SlackInstallationView,
} from '../services/installations.service';

@Controller('api/integrations/slack/installations')
export class SlackInstallationsController {
  constructor(private readonly svc: SlackInstallationsService) {}

  @Get()
  @RequireOrgRole('admin')
  async list(
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<ApiResponse<SlackInstallationView[]>> {
    const data = await this.svc.listForOrg(membership.organizationId);
    return { data, message: 'OK', success: true };
  }

  /** The scopes the pasted token's app must hold, for the settings screen. */
  @Get('scopes')
  @RequireOrgRole('admin')
  scopes(): ApiResponse<{ scopes: string[] }> {
    return {
      data: { scopes: [...SLACK_BOT_SCOPES] },
      message: 'OK',
      success: true,
    };
  }

  @Post('token')
  @RequireOrgRole('admin')
  async connect(
    @OrgMembership() membership: OrgMembershipContext,
    @Body(new ZodValidationPipe(ConnectTokenBodySchema)) body: ConnectTokenBody,
  ): Promise<ApiResponse<SlackInstallationView>> {
    const data = await this.svc.connectToken({
      orgId: membership.organizationId,
      token: body.token,
      userId: LOCAL_USER_ID,
    });
    return { data, message: 'OK', success: true };
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
