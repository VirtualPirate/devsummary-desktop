import { Controller, Get, Query } from '@nestjs/common';
import {
  ListCommitsQuerySchema,
  type ApiResponse,
  type ListCommitsQuery,
  type PaginatedCommits,
} from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../organizations/dto/zod-validation.pipe';
import { CommitsService } from '../services/commits.service';

@Controller('api/organizations/current/commits')
export class CommitsController {
  constructor(private readonly commits: CommitsService) {}

  @Get()
  @RequireOrgRole('member')
  async list(
    @OrgMembership() m: OrgMembershipContext,
    @Query(new ZodValidationPipe(ListCommitsQuerySchema))
    q: ListCommitsQuery,
  ): Promise<ApiResponse<PaginatedCommits>> {
    const data = await this.commits.list(m.organizationId, q);
    return { data, message: 'OK', success: true };
  }
}
