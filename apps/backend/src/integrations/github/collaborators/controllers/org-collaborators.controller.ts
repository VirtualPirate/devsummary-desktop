import { Controller, Get } from '@nestjs/common';
import type { ApiResponse, Collaborator } from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../../organizations/decorators/require-org-role.decorator';
import { CollaboratorsRepository } from '../repositories/collaborators.repository';

@Controller('api/organizations/current/collaborators')
export class OrgCollaboratorsController {
  constructor(private readonly collaborators: CollaboratorsRepository) {}

  @Get()
  @RequireOrgRole('member')
  async list(
    @OrgMembership() m: OrgMembershipContext,
  ): Promise<ApiResponse<Collaborator[]>> {
    const rows = await this.collaborators.listByOrganization(m.organizationId);
    const data: Collaborator[] = rows.map((row) => ({
      id: row.id,
      githubUserId: String(row.githubUserId),
      login: row.login,
      avatarUrl: row.avatarUrl,
      htmlUrl: row.htmlUrl,
    }));
    return { data, message: 'OK', success: true };
  }
}
