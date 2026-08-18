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
  CreateTeamSchema,
  SetTeamCollaboratorsSchema,
  UpdateTeamSchema,
  type ApiResponse,
  type CreateTeamRequest,
  type SetTeamCollaboratorsRequest,
  type Team,
  type UpdateTeamRequest,
} from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../../organizations/dto/zod-validation.pipe';
import { TeamsService } from '../services/teams.service';
import { TeamIdParamSchema, type TeamIdParam } from '../dto/teams.dto';

type SessionPayload = { user: { id: string } };

@Controller('api/organizations/current/teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequireOrgRole('member')
  async list(
    @OrgMembership() m: OrgMembershipContext,
  ): Promise<ApiResponse<Team[]>> {
    const data = await this.teams.list(m.organizationId);
    return { data, message: 'OK', success: true };
  }

  @Post()
  @RequireOrgRole('admin')
  async create(
    @OrgMembership() m: OrgMembershipContext,
    @Session() session: SessionPayload,
    @Body(new ZodValidationPipe(CreateTeamSchema)) body: CreateTeamRequest,
  ): Promise<ApiResponse<Team>> {
    const data = await this.teams.create(
      m.organizationId,
      session.user.id,
      body,
    );
    return { data, message: 'Team created', success: true };
  }

  @Get(':teamId')
  @RequireOrgRole('member')
  async get(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(TeamIdParamSchema)) params: TeamIdParam,
  ): Promise<ApiResponse<Team>> {
    const data = await this.teams.get(m.organizationId, params.teamId);
    return { data, message: 'OK', success: true };
  }

  @Patch(':teamId')
  @RequireOrgRole('admin')
  async update(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(TeamIdParamSchema)) params: TeamIdParam,
    @Body(new ZodValidationPipe(UpdateTeamSchema)) body: UpdateTeamRequest,
  ): Promise<ApiResponse<Team>> {
    const data = await this.teams.update(m.organizationId, params.teamId, body);
    return { data, message: 'Team updated', success: true };
  }

  @Put(':teamId/collaborators')
  @RequireOrgRole('admin')
  async setCollaborators(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(TeamIdParamSchema)) params: TeamIdParam,
    @Body(new ZodValidationPipe(SetTeamCollaboratorsSchema))
    body: SetTeamCollaboratorsRequest,
  ): Promise<ApiResponse<Team>> {
    const data = await this.teams.setCollaborators(
      m.organizationId,
      params.teamId,
      body,
    );
    return { data, message: 'OK', success: true };
  }

  @Delete(':teamId')
  @RequireOrgRole('admin')
  @HttpCode(204)
  async delete(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(TeamIdParamSchema)) params: TeamIdParam,
  ): Promise<void> {
    await this.teams.delete(m.organizationId, params.teamId);
  }
}
