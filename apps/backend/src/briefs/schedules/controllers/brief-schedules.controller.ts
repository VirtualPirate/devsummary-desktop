import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import {
  CreateBriefScheduleSchema,
  UpdateBriefScheduleSchema,
  type ApiResponse,
  type BriefScheduleResponse,
  type CreateBriefScheduleRequest,
  type UpdateBriefScheduleRequest,
} from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../../organizations/dto/zod-validation.pipe';
import { BriefSchedulesService } from '../services/brief-schedules.service';
import {
  ScheduleIdParamSchema,
  type ScheduleIdParam,
} from '../dto/brief-schedules.dto';

type SessionPayload = { user: { id: string } };

@Controller('api/organizations/current/brief-schedules')
export class BriefSchedulesController {
  constructor(private readonly schedules: BriefSchedulesService) {}

  @Get()
  @RequireOrgRole('member')
  async list(
    @OrgMembership() m: OrgMembershipContext,
  ): Promise<ApiResponse<BriefScheduleResponse[]>> {
    const data = await this.schedules.list(m.organizationId);
    return { data, message: 'OK', success: true };
  }

  @Post()
  @RequireOrgRole('admin')
  async create(
    @OrgMembership() m: OrgMembershipContext,
    @Session() session: SessionPayload,
    @Body(new ZodValidationPipe(CreateBriefScheduleSchema))
    body: CreateBriefScheduleRequest,
  ): Promise<ApiResponse<BriefScheduleResponse>> {
    const data = await this.schedules.create(
      m.organizationId,
      session.user.id,
      body,
    );
    return { data, message: 'Brief schedule created', success: true };
  }

  @Get(':id')
  @RequireOrgRole('member')
  async get(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ScheduleIdParamSchema))
    params: ScheduleIdParam,
  ): Promise<ApiResponse<BriefScheduleResponse>> {
    const data = await this.schedules.get(m.organizationId, params.id);
    return { data, message: 'OK', success: true };
  }

  @Patch(':id')
  @RequireOrgRole('admin')
  async update(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ScheduleIdParamSchema))
    params: ScheduleIdParam,
    @Body(new ZodValidationPipe(UpdateBriefScheduleSchema))
    body: UpdateBriefScheduleRequest,
  ): Promise<ApiResponse<BriefScheduleResponse>> {
    const data = await this.schedules.update(m.organizationId, params.id, body);
    return { data, message: 'Brief schedule updated', success: true };
  }

  @Post(':id/pause')
  @RequireOrgRole('admin')
  async pause(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ScheduleIdParamSchema))
    params: ScheduleIdParam,
  ): Promise<ApiResponse<BriefScheduleResponse>> {
    const data = await this.schedules.pause(m.organizationId, params.id);
    return { data, message: 'Paused', success: true };
  }

  @Post(':id/resume')
  @RequireOrgRole('admin')
  async resume(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ScheduleIdParamSchema))
    params: ScheduleIdParam,
  ): Promise<ApiResponse<BriefScheduleResponse>> {
    const data = await this.schedules.resume(m.organizationId, params.id);
    return { data, message: 'Resumed', success: true };
  }

  @Delete(':id')
  @RequireOrgRole('admin')
  @HttpCode(204)
  async delete(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(ScheduleIdParamSchema))
    params: ScheduleIdParam,
  ): Promise<void> {
    await this.schedules.delete(m.organizationId, params.id);
  }
}
