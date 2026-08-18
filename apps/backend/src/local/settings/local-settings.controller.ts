import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import type {
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
  TestEmailSchema,
  TestSlackMessageSchema,
  UpdateLocalCredentialsSchema,
  type TestEmailBody,
  type TestSlackMessageBody,
  type UpdateLocalCredentialsBody,
} from './dto/local-settings.dto';
import { LocalSettingsService } from './local-settings.service';

/**
 * The settings screen's only backend surface. Credentials go **in** and never
 * come back out: `GET` answers with booleans, so a compromised renderer cannot
 * read the user's Slack token or mail password back off the wire.
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

  @Post('test-email')
  @RequireOrgRole('admin')
  async testEmail(
    @Body(new ZodValidationPipe(TestEmailSchema)) body: TestEmailBody,
  ): Promise<ApiResponse<LocalSettingsTestResult>> {
    const data = await this.svc.testEmail(body.to);
    return { data, message: 'OK', success: true };
  }

  @Post('test-slack-message')
  @RequireOrgRole('admin')
  async testSlack(
    @OrgMembership() membership: OrgMembershipContext,
    @Body(new ZodValidationPipe(TestSlackMessageSchema))
    body: TestSlackMessageBody,
  ): Promise<ApiResponse<LocalSettingsTestResult>> {
    const data = await this.svc.testSlackMessage(
      membership.organizationId,
      body.channelId,
      body.text,
    );
    return { data, message: 'OK', success: true };
  }
}
