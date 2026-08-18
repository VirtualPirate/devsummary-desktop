import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import type {
  ApiResponse,
  GithubInstallationWithRepos,
} from '@launchstack/api-interfaces';
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
import { GithubInstallationsService } from '../services/installations.service';

@Controller('api/integrations/github')
export class GithubInstallationsController {
  constructor(private readonly svc: GithubInstallationsService) {}

  /**
   * Connection status. Still an array (and still `GithubInstallationWithRepos`)
   * so the repository list the setup screen reads is unchanged; a desktop
   * workspace holds at most one credential, so it is empty or a single entry.
   */
  @Get()
  @RequireOrgRole('member')
  async status(
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<ApiResponse<GithubInstallationWithRepos[]>> {
    const data = await this.svc.listForOrg(membership.organizationId);
    return { data, message: 'OK', success: true };
  }

  /**
   * Paste a fine-grained PAT. Validated against GitHub before it is stored, so
   * a bad token is a 400 here rather than a failure hours later inside ingest.
   */
  @Post('token')
  @RequireOrgRole('admin')
  async connect(
    @OrgMembership() membership: OrgMembershipContext,
    @Body(new ZodValidationPipe(ConnectTokenBodySchema)) body: ConnectTokenBody,
  ): Promise<ApiResponse<GithubInstallationWithRepos>> {
    const data = await this.svc.connect({
      orgId: membership.organizationId,
      token: body.token,
    });
    return { data, message: 'OK', success: true };
  }

  @Delete()
  @RequireOrgRole('admin')
  @HttpCode(204)
  async disconnect(
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<void> {
    await this.svc.disconnect(membership.organizationId);
  }

  /** Path kept from the App era — the setup screen's "refresh repositories". */
  @Post('installations/:id/sync')
  @RequireOrgRole('admin')
  async sync(
    @OrgMembership() membership: OrgMembershipContext,
    @Param(new ZodValidationPipe(InstallationIdParamSchema))
    params: { id: string },
  ): Promise<ApiResponse<GithubInstallationWithRepos>> {
    const data = await this.svc.sync(membership.organizationId, params.id);
    return { data, message: 'OK', success: true };
  }
}
