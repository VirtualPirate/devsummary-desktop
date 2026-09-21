import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import type {
  AgentCliStatus,
  ApiResponse,
  EmailVerificationStatus,
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
  ProviderModelsQuerySchema,
  RequestEmailVerificationSchema,
  UpdateLocalCredentialsSchema,
  type AgentCliParam,
  type AgentCliQuery,
  type ProviderModelsQuery,
  type RequestEmailVerificationBody,
  type UpdateLocalCredentialsBody,
} from './dto/local-settings.dto';
import { EmailVerificationService } from './email-verification.service';
import { LocalSettingsService } from './local-settings.service';

/**
 * The settings screen's only backend surface. Credentials go **in** and never
 * come back out: `GET` answers with booleans, so a compromised renderer cannot
 * read the user's provider key back off the wire.
 */
@Controller('api/local-settings')
export class LocalSettingsController {
  constructor(
    private readonly svc: LocalSettingsService,
    private readonly verification: EmailVerificationService,
  ) {}

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

  /**
   * The model ids the picker offers for one provider — the CLI's own catalogue
   * or the account's `/models` listing. Best effort: an empty array means
   * nothing could be listed, and the picker still accepts a typed id.
   */
  @Get('models')
  @RequireOrgRole('member')
  async models(
    @Query(new ZodValidationPipe(ProviderModelsQuerySchema))
    q: ProviderModelsQuery,
  ): Promise<ApiResponse<string[]>> {
    const data = await this.svc.providerModels(q.provider);
    return { data, message: 'OK', success: true };
  }

  /**
   * One poll of the magic-link gate. Cheap and idempotent: a verified install
   * answers from disk, and a check that cannot reach the API stays pending
   * rather than failing — this is what the settings screen polls every 4 s.
   */
  @Get('verification')
  @RequireOrgRole('member')
  async verificationStatus(): Promise<ApiResponse<EmailVerificationStatus>> {
    return {
      data: await this.verification.check(),
      message: 'OK',
      success: true,
    };
  }

  /** Mail a link to this address. Pressing Resend is the same call again. */
  @Post('verification')
  @RequireOrgRole('admin')
  async requestVerification(
    @Body(new ZodValidationPipe(RequestEmailVerificationSchema))
    body: RequestEmailVerificationBody,
  ): Promise<ApiResponse<EmailVerificationStatus>> {
    return {
      data: await this.verification.request(body.email),
      message: 'Check your email',
      success: true,
    };
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
