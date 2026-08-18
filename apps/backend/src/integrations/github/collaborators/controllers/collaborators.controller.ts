import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { ApiResponse } from '@launchstack/api-interfaces';
import { AppError } from '../../../../common/errors';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../../../organizations/dto/zod-validation.pipe';
import { JOB, JobQueueService } from '../../../../jobs';
import { GithubRepositoriesRepository } from '../../repositories/repositories.repository';
import { RepositoryCollaboratorsRepository } from '../repositories/repository-collaborators.repository';
import type { CollaboratorDto } from '../dto/collaborators.dto';
import { RepositoryIdParamSchema } from '../dto/collaborators.dto';

@Controller('api/integrations/github/repositories/:id/collaborators')
export class GithubCollaboratorsController {
  constructor(
    private readonly repoCollabs: RepositoryCollaboratorsRepository,
    private readonly repos: GithubRepositoriesRepository,
    private readonly queue: JobQueueService,
  ) {}

  @Get()
  @RequireOrgRole('admin')
  async list(
    @Param(new ZodValidationPipe(RepositoryIdParamSchema))
    params: { id: string },
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<ApiResponse<CollaboratorDto[]>> {
    const repo = await this.repos.findByIdScopedToOrg(
      params.id,
      membership.organizationId,
    );
    if (!repo) {
      throw AppError.GITHUB_REPOSITORY_NOT_FOUND();
    }

    const rows = await this.repoCollabs.findActiveByRepoId(params.id);
    const data: CollaboratorDto[] = rows.map((r) => ({
      id: r.joinId,
      collaboratorId: r.collaboratorId,
      githubUserId: r.githubUserId.toString(),
      login: r.login,
      avatarUrl: r.avatarUrl,
      htmlUrl: r.htmlUrl,
      type: r.type,
      siteAdmin: r.siteAdmin,
      roleName: r.roleName,
      permissions: {
        admin: r.permissionAdmin,
        maintain: r.permissionMaintain,
        push: r.permissionPush,
        triage: r.permissionTriage,
        pull: r.permissionPull,
      },
      updatedAt: r.updatedAt.toISOString(),
    }));

    return { data, message: 'OK', success: true };
  }

  @Post('sync')
  @RequireOrgRole('admin')
  @HttpCode(202)
  async sync(
    @Param(new ZodValidationPipe(RepositoryIdParamSchema))
    params: { id: string },
    @OrgMembership() membership: OrgMembershipContext,
  ): Promise<ApiResponse<{ jobId: string }>> {
    const repo = await this.repos.findByIdScopedToOrg(
      params.id,
      membership.organizationId,
    );
    if (!repo) {
      throw AppError.GITHUB_REPOSITORY_NOT_FOUND();
    }

    const jobId = await this.queue.enqueue(
      JOB.syncRepoCollaborators,
      {
        repositoryId: params.id,
        trigger: 'manual',
        organizationId: membership.organizationId,
      },
      { phase: 'fetching', organizationId: membership.organizationId },
    );

    return { data: { jobId }, message: 'sync enqueued', success: true };
  }
}
