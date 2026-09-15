import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import type {
  AgentCliStatus,
  ApiResponse,
  LocalSettingsStatus,
  LocalSettingsTestResult,
} from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../organizations/dto/zod-validation.pipe';
import {
  AgentCliParamSchema,
  AgentCliQuerySchema,
  UpdateLocalCredentialsSchema,
  type AgentCliParam,
  type AgentCliQuery,
  type UpdateLocalCredentialsBody,
} from './dto/local-settings.dto';
import { LocalSettingsService } from './local-settings.service';

/**
 * The settings screen's only backend surface. Credentials go **in** and never
 * come back out: `GET` answers with booleans, so a compromised renderer cannot
 * read the user's Slack token or provider key back off the wire.
 */
@Controller('api/local-settings')
export class LocalSettingsController {
  constructor(private readonly svc: LocalSettingsService) {}

  @Get()
  @RequireOrgRole('member')
  async status(): Promise<ApiResponse<LocalSettingsStatus>> {
    return { data: await this.svc.status(), message: 'OK', success: true };
  }

  @Put('credentials')
  @RequireOrgRole('admin')
  async update(
    @OrgMembership() membership: OrgMembershipContext,
    @Body(new ZodValidationPipe(UpdateLocalCredentialsSchema))
    body: UpdateLocalCredentialsBody,
  ): Promise<ApiResponse<LocalSettingsStatus>> {
    const data = await this.svc.updateCredentials(
      membership.organizationId,
      body,
    );
    return { data, message: 'OK', success: true };
  }

  /** Which coding-agent CLIs can actually run on this machine. */
  @Get('agents')
  @RequireOrgRole('member')
  async agents(
    @Query(new ZodValidationPipe(AgentCliQuerySchema)) q: AgentCliQuery,
  ): Promise<ApiResponse<AgentCliStatus[]>> {
    const data = await this.svc.agentClis(q.refresh === '1');
    return { data, message: 'OK', success: true };
  }

  @Post('agents/:id/test')
  @RequireOrgRole('admin')
  async testAgent(
    @Param(new ZodValidationPipe(AgentCliParamSchema)) params: AgentCliParam,
  ): Promise<ApiResponse<LocalSettingsTestResult>> {
    const data = await this.svc.testAgentCli(params.id);
    return { data, message: 'OK', success: true };
  }
}
