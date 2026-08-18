import { Controller, Get, Query } from '@nestjs/common';
import {
  GetCommitActivityQuerySchema,
  type ApiResponse,
  type CommitActivityResponse,
  type GetCommitActivityQuery,
} from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../organizations/dto/zod-validation.pipe';
import { AnalyticsService } from '../services/analytics.service';

@Controller('api/organizations/current/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('commit-activity')
  @RequireOrgRole('member')
  async commitActivity(
    @OrgMembership() m: OrgMembershipContext,
    @Query(new ZodValidationPipe(GetCommitActivityQuerySchema))
    q: GetCommitActivityQuery,
  ): Promise<ApiResponse<CommitActivityResponse>> {
    const data = await this.analytics.getCommitActivity(m.organizationId, q);
    return { data, message: 'OK', success: true };
  }
}
