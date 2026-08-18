import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
} from '@nestjs/common';
import {
  UpdateMemberRoleSchema,
  type UpdateMemberRoleRequest,
  type ApiResponse,
  type OrganizationMember,
} from '@launchstack/api-interfaces';
import { ZodValidationPipe } from '../dto/zod-validation.pipe';
import { MembersService } from '../services/members.service';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../decorators/org-membership.decorator';
import { RequireOrgRole } from '../decorators/require-org-role.decorator';

@Controller('api/organizations/current/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequireOrgRole('member')
  async list(
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<ApiResponse<OrganizationMember[]>> {
    const data = await this.members.listMembers(membership.organizationId);
    return { data, message: 'OK', success: true };
  }

  @Patch(':memberId')
  @RequireOrgRole('owner')
  async updateRole(
    @OrgMembership() membership: OrgMembershipContext,
    @Param('memberId') memberId: string,
    @Body(new ZodValidationPipe(UpdateMemberRoleSchema))
    body: UpdateMemberRoleRequest,
  ): Promise<ApiResponse<OrganizationMember>> {
    const data = await this.members.updateMemberRole({
      organizationId: membership.organizationId,
      memberId,
      newRole: body.role,
    });
    return { data, message: 'Role updated', success: true };
  }

  @Delete('me')
  @RequireOrgRole('member')
  @HttpCode(204)
  async leave(
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<void> {
    await this.members.leaveOrganization({
      organizationId: membership.organizationId,
      callerMembership: membership,
    });
  }

  @Delete(':memberId')
  @RequireOrgRole('admin')
  @HttpCode(204)
  async remove(
    @OrgMembership() membership: OrgMembershipContext,
    @Param('memberId') memberId: string,
  ): Promise<void> {
    await this.members.removeMember({
      organizationId: membership.organizationId,
      callerMembership: membership,
      targetMemberId: memberId,
    });
  }
}
