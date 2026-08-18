import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type {
  ApiResponse,
  ListRepositoryBranchesResponse,
  RepositoryIngestStatusResponse,
  SetRepositoryBranchesResponse,
} from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../../organizations/dto/zod-validation.pipe';
import {
  RepositoryIdParamSchema,
  SetRepositoryBranchesBodySchema,
  type SetRepositoryBranchesBody,
} from '../dto/repositories.dto';
import { IngestStatusService } from '../services/ingest-status.service';
import { RepositoryBranchesService } from '../services/repository-branches.service';

@Controller('api/integrations/github/repositories')
export class GithubRepositoriesController {
  constructor(
    private readonly svc: RepositoryBranchesService,
    private readonly ingest: IngestStatusService,
  ) {}

  /**
   * How far each tracked repository's first read has got — drives the
   * post-connect onboarding console, whose "Create first schedule" button is
   * gated on `ingesting`.
   *
   * Declared before `:repoId/branches` for readability only; the two never
   * collide (one segment vs two).
   */
  @Get('ingest-status')
  @RequireOrgRole('member')
  async ingestStatus(
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<ApiResponse<RepositoryIngestStatusResponse>> {
    const data = await this.ingest.forOrganization(membership.organizationId);
    return { data, message: 'OK', success: true };
  }

  /**
   * Live from GitHub, not from our tables — we store one chosen branch per
   * repository, never the whole branch list.
   */
  @Get(':repoId/branches')
  @RequireOrgRole('admin')
  async listBranches(
    @OrgMembership() membership: OrgMembershipContext,
    @Param(new ZodValidationPipe(RepositoryIdParamSchema))
    params: { repoId: string },
  ): Promise<ApiResponse<ListRepositoryBranchesResponse>> {
    const data = await this.svc.listBranches(
      membership.organizationId,
      params.repoId,
    );
    return { data, message: 'OK', success: true };
  }

  /** Batch: sets each repository's branch and starts its first ingest. */
  @Post('branches')
  @RequireOrgRole('admin')
  @HttpCode(202)
  async setBranches(
    @OrgMembership() membership: OrgMembershipContext,
    @Body(new ZodValidationPipe(SetRepositoryBranchesBodySchema))
    body: SetRepositoryBranchesBody,
  ): Promise<ApiResponse<SetRepositoryBranchesResponse>> {
    const data = await this.svc.setBranches(membership.organizationId, body);
    return { data, message: 'accepted', success: true };
  }
}
