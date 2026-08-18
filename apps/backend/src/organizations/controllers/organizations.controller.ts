import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateOrganizationSchema,
  type CreateOrganizationRequest,
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
import { LOCAL_USER_ID } from '../../local/local-identity';

@Controller('api/organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(CreateOrganizationSchema))
    body: CreateOrganizationRequest,
  ): Promise<ApiResponse<Organization>> {
    const result = await this.orgs.createOrganization(LOCAL_USER_ID, body);
    return {
      data: result.organization,
      message: 'Organization created',
      success: true,
    };
  }

  @Get('me')
  async listMine(): Promise<ApiResponse<MyOrganization[]>> {
    const data = await this.orgs.listMyOrganizations(LOCAL_USER_ID);
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
}
