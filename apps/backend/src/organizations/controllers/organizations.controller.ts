import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import {
  CreateOrganizationSchema,
  type CreateOrganizationRequest,
  TransferOwnershipSchema,
  type TransferOwnershipRequest,
  UpdateOrganizationSchema,
  type UpdateOrganizationRequest,
  type ApiResponse,
  type MyOrganization,
  type Organization,
} from '@launchstack/api-interfaces';
import { ZodValidationPipe } from '../dto/zod-validation.pipe';
import { OrganizationsService } from '../services/organizations.service';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../decorators/org-membership.decorator';
import { RequireOrgRole } from '../decorators/require-org-role.decorator';

type SessionPayload = {
  user: { id: string; email: string; emailVerified: boolean };
};

@Controller('api/organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  async create(
    @Session() session: SessionPayload,
    @Body(new ZodValidationPipe(CreateOrganizationSchema))
    body: CreateOrganizationRequest,
  ): Promise<ApiResponse<Organization>> {
    const result = await this.orgs.createOrganization(session.user.id, body);
    return {
      data: result.organization,
      message: 'Organization created',
      success: true,
    };
  }

  @Get('me')
  async listMine(
    @Session() session: SessionPayload,
  ): Promise<ApiResponse<MyOrganization[]>> {
    const data = await this.orgs.listMyOrganizations(session.user.id);
    return { data, message: 'OK', success: true };
  }

  @Get('current')
  @RequireOrgRole('member')
  async getCurrent(@OrgMembership() membership: OrgMembershipContext): Promise<
    ApiResponse<{
      organization: Organization;
      role: OrgMembershipContext['role'];
    }>
  > {
    const data = await this.orgs.getCurrentOrganization(
      membership.organizationId,
      membership.role,
    );
    return { data, message: 'OK', success: true };
  }

  @Patch('current')
  @RequireOrgRole('admin')
  async updateCurrent(
    @OrgMembership() membership: OrgMembershipContext,
    @Body(new ZodValidationPipe(UpdateOrganizationSchema))
    body: UpdateOrganizationRequest,
  ): Promise<ApiResponse<Organization>> {
    const data = await this.orgs.updateOrganization(
      membership.organizationId,
      body,
    );
    return { data, message: 'Organization updated', success: true };
  }

  @Delete('current')
  @RequireOrgRole('owner')
  @HttpCode(204)
  async deleteCurrent(
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<void> {
    await this.orgs.deleteOrganization(membership.organizationId);
  }

  @Post('current/transfer-ownership')
  @RequireOrgRole('owner')
  async transfer(
    @OrgMembership() membership: OrgMembershipContext,
    @Body(new ZodValidationPipe(TransferOwnershipSchema))
    body: TransferOwnershipRequest,
  ): Promise<ApiResponse<Organization>> {
    const data = await this.orgs.transferOwnership({
      organizationId: membership.organizationId,
      currentOwnerUserId: membership.userId,
      newOwnerUserId: body.newOwnerUserId,
    });
    return { data, message: 'Ownership transferred', success: true };
  }
}
