import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import {
  CreateProjectSchema,
  SetProjectRepositoriesSchema,
  UpdateProjectSchema,
  type ApiResponse,
  type CreateProjectRequest,
  type Project,
  type SetProjectRepositoriesRequest,
  type UpdateProjectRequest,
} from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../../organizations/dto/zod-validation.pipe';
import { ProjectsService } from '../services/projects.service';
import { ProjectIdParamSchema, type ProjectIdParam } from '../dto/projects.dto';

type SessionPayload = { user: { id: string } };

@Controller('api/organizations/current/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequireOrgRole('member')
  async list(
    @OrgMembership() m: OrgMembershipContext,
  ): Promise<ApiResponse<Project[]>> {
    const data = await this.projects.list(m.organizationId);
    return { data, message: 'OK', success: true };
  }

  @Post()
  @RequireOrgRole('admin')
  async create(
    @OrgMembership() m: OrgMembershipContext,
    @Session() session: SessionPayload,
    @Body(new ZodValidationPipe(CreateProjectSchema))
    body: CreateProjectRequest,
  ): Promise<ApiResponse<Project>> {
    const data = await this.projects.create(
      m.organizationId,
      session.user.id,
      body,
    );
    return { data, message: 'Project created', success: true };
  }

  @Get(':projectId')
  @RequireOrgRole('member')
  async get(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ProjectIdParamSchema)) params: ProjectIdParam,
  ): Promise<ApiResponse<Project>> {
    const data = await this.projects.get(m.organizationId, params.projectId);
    return { data, message: 'OK', success: true };
  }

  @Patch(':projectId')
  @RequireOrgRole('admin')
  async update(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ProjectIdParamSchema)) params: ProjectIdParam,
    @Body(new ZodValidationPipe(UpdateProjectSchema))
    body: UpdateProjectRequest,
  ): Promise<ApiResponse<Project>> {
    const data = await this.projects.update(
      m.organizationId,
      params.projectId,
      body,
    );
    return { data, message: 'Project updated', success: true };
  }

  @Put(':projectId/repositories')
  @RequireOrgRole('admin')
  async setRepositories(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ProjectIdParamSchema)) params: ProjectIdParam,
    @Body(new ZodValidationPipe(SetProjectRepositoriesSchema))
    body: SetProjectRepositoriesRequest,
  ): Promise<ApiResponse<Project>> {
    const data = await this.projects.setRepositories(
      m.organizationId,
      params.projectId,
      body,
    );
    return { data, message: 'OK', success: true };
  }

  @Delete(':projectId')
  @RequireOrgRole('admin')
  @HttpCode(204)
  async delete(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ProjectIdParamSchema)) params: ProjectIdParam,
  ): Promise<void> {
    await this.projects.delete(m.organizationId, params.projectId);
  }
}
