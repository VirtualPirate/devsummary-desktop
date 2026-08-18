import { Controller, Get } from '@nestjs/common';
import type {
  ApiResponse,
  JobActivityResponse,
} from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../organizations/decorators/require-org-role.decorator';
import { JobActivityService } from './job-activity.service';

@Controller('api/organizations/current/jobs')
export class JobActivityController {
  constructor(private readonly jobs: JobActivityService) {}

  @Get('activity')
  @RequireOrgRole('member')
  async activity(
    @OrgMembership() m: OrgMembershipContext,
  ): Promise<ApiResponse<JobActivityResponse>> {
    const data = await this.jobs.forOrganization(m.organizationId);
    return { data, message: 'OK', success: true };
  }
}
