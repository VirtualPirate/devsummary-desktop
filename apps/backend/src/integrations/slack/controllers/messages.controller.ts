import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { ApiResponse, SlackChannel } from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../../organizations/dto/zod-validation.pipe';
import {
  ChannelIdParamSchema,
  PostMessageBodySchema,
  type PostMessageBody,
} from '../dto/installations.dto';
import { SlackMessagesService } from '../services/messages.service';

@Controller('api/integrations/slack')
export class SlackMessagesController {
  constructor(private readonly svc: SlackMessagesService) {}

  @Get('channels')
  @RequireOrgRole('admin')
  async listChannels(
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<ApiResponse<SlackChannel[]>> {
    const data = await this.svc.listChannels(membership.organizationId);
    return { data, message: 'OK', success: true };
  }

  @Post('channels/:channelId/join')
  @RequireOrgRole('admin')
  @HttpCode(204)
  async joinChannel(
    @OrgMembership() membership: OrgMembershipContext,
    @Param(new ZodValidationPipe(ChannelIdParamSchema))
    params: { channelId: string },
  ): Promise<void> {
    await this.svc.joinChannel(membership.organizationId, params.channelId);
  }

  @Get('members')
  @RequireOrgRole('admin')
  async listMembers(
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<ApiResponse<unknown[]>> {
    const data = await this.svc.listMembers(membership.organizationId);
    return { data, message: 'OK', success: true };
  }

  @Post('messages')
  @RequireOrgRole('admin')
  async postMessage(
    @OrgMembership() membership: OrgMembershipContext,
    @Body(new ZodValidationPipe(PostMessageBodySchema))
    body: PostMessageBody,
  ): Promise<ApiResponse<{ success: true; ts: string }>> {
    const data = await this.svc.postMessage(
      membership.organizationId,
      body.channelId,
      body.text,
    );
    return { data, message: 'OK', success: true };
  }
}
