import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AllowAnonymous, Session } from '@thallesp/nestjs-better-auth';
import {
  AcceptInviteSchema,
  type AcceptInviteRequest,
  CreateInviteSchema,
  type CreateInviteRequest,
  DeclineInviteSchema,
  type DeclineInviteRequest,
  InviteListQuerySchema,
  type ApiResponse,
  type InvitePreview,
  type InviteStatus,
  type Organization,
  type OrganizationInvite,
} from '@launchstack/api-interfaces';
import { ZodValidationPipe } from '../dto/zod-validation.pipe';
import { InvitesService } from '../services/invites.service';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../decorators/org-membership.decorator';
import { RequireOrgRole } from '../decorators/require-org-role.decorator';

type SessionPayload = {
  user: { id: string; email: string; emailVerified: boolean };
};

@Controller('api')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post('organizations/current/invites')
  @RequireOrgRole('admin')
  async create(
    @OrgMembership() membership: OrgMembershipContext,
    @Body(new ZodValidationPipe(CreateInviteSchema))
    body: CreateInviteRequest,
  ): Promise<ApiResponse<OrganizationInvite>> {
    const data = await this.invites.createInvite({
      organizationId: membership.organizationId,
      inviterUserId: membership.userId,
      email: body.email,
      role: body.role,
    });
    return { data, message: 'Invite sent', success: true };
  }

  @Get('organizations/current/invites')
  @RequireOrgRole('admin')
  async listOrg(
    @OrgMembership() membership: OrgMembershipContext,
    @Query(new ZodValidationPipe(InviteListQuerySchema))
    query: { status: InviteStatus | 'all' },
  ): Promise<ApiResponse<OrganizationInvite[]>> {
    const data = await this.invites.listOrganizationInvites(
      membership.organizationId,
      query.status,
    );
    return { data, message: 'OK', success: true };
  }

  @Delete('organizations/current/invites/:inviteId')
  @RequireOrgRole('admin')
  @HttpCode(204)
  async revoke(
    @OrgMembership() membership: OrgMembershipContext,
    @Param('inviteId') inviteId: string,
  ): Promise<void> {
    await this.invites.revokeInvite({
      organizationId: membership.organizationId,
      inviteId,
    });
  }

  @Post('organizations/current/invites/:inviteId/resend')
  @RequireOrgRole('admin')
  async resend(
    @OrgMembership() membership: OrgMembershipContext,
    @Param('inviteId') inviteId: string,
  ): Promise<ApiResponse<OrganizationInvite>> {
    const data = await this.invites.resendInvite({
      organizationId: membership.organizationId,
      inviteId,
    });
    return { data, message: 'Invite resent', success: true };
  }

  @Get('invites/me')
  async listMine(
    @Session() session: SessionPayload,
  ): Promise<ApiResponse<OrganizationInvite[]>> {
    if (!session.user.emailVerified) {
      return { data: [], message: 'OK', success: true };
    }
    const data = await this.invites.listMyInvites(session.user.email);
    return { data, message: 'OK', success: true };
  }

  @Post('invites/accept')
  async accept(
    @Session() session: SessionPayload,
    @Body(new ZodValidationPipe(AcceptInviteSchema))
    body: AcceptInviteRequest,
  ): Promise<ApiResponse<{ organization: Organization }>> {
    const result = await this.invites.acceptInvite({
      caller: {
        userId: session.user.id,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
      },
      token: body.token,
      inviteId: body.inviteId,
    });
    return {
      data: { organization: result.organization },
      message: 'Invite accepted',
      success: true,
    };
  }

  @Post('invites/decline')
  @HttpCode(204)
  async decline(
    @Session() session: SessionPayload,
    @Body(new ZodValidationPipe(DeclineInviteSchema))
    body: DeclineInviteRequest,
  ): Promise<void> {
    await this.invites.declineInvite({
      caller: {
        userId: session.user.id,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
      },
      token: body.token,
      inviteId: body.inviteId,
    });
  }

  @Get('invites/preview')
  @AllowAnonymous()
  async preview(
    @Query('token') token: string | undefined,
  ): Promise<ApiResponse<InvitePreview>> {
    if (!token || typeof token !== 'string') {
      return {
        data: {
          organizationName: '',
          inviterName: null,
          invitedEmail: '',
          role: 'viewer',
          expiresAt: new Date(0).toISOString(),
        },
        message: 'Missing token',
        success: false,
      };
    }
    const data = await this.invites.previewInvite(token);
    return { data, message: 'OK', success: true };
  }
}
