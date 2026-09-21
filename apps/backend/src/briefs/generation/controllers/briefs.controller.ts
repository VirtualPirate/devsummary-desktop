import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  BriefCommitsQuerySchema,
  BriefPreviewQuerySchema,
  GenerateBriefSchema,
  ListBriefsQuerySchema,
  type ApiResponse,
  type BriefCommitsQuery,
  type BriefPreviewQuery,
  type BriefPreviewResponse,
  type BriefReportResponse,
  type BriefResponse,
  type GenerateBriefEnqueueResponse,
  type GenerateBriefRequest,
  type ListBriefsQuery,
  type PaginatedBriefs,
  type PaginatedBriefCommits,
} from '@launchstack/api-interfaces';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../../organizations/dto/zod-validation.pipe';
import { BriefsService } from '../services/briefs.service';
import { BriefReportService } from '../services/brief-report.service';
import { BriefIdParamSchema, type BriefIdParam } from '../dto/briefs.dto';

@Controller('api/organizations/current/briefs')
export class BriefsController {
  constructor(
    private readonly briefs: BriefsService,
    private readonly report: BriefReportService,
  ) {}

  @Get()
  @RequireOrgRole('member')
  async list(
    @OrgMembership() m: OrgMembershipContext,
    @Query(new ZodValidationPipe(ListBriefsQuerySchema)) q: ListBriefsQuery,
  ): Promise<ApiResponse<PaginatedBriefs>> {
    const data = await this.briefs.list(m.organizationId, q);
    return { data, message: 'OK', success: true };
  }

  /**
   * Declared before `:briefId` — Nest matches in declaration order, so the
   * dynamic route would otherwise swallow `/preview` and fail uuid validation.
   */
  @Get('preview')
  @RequireOrgRole('member')
  async preview(
    @OrgMembership() m: OrgMembershipContext,
    @Query(new ZodValidationPipe(BriefPreviewQuerySchema)) q: BriefPreviewQuery,
  ): Promise<ApiResponse<BriefPreviewResponse>> {
    const data = await this.briefs.preview(m.organizationId, q);
    return { data, message: 'OK', success: true };
  }

  @Get(':briefId')
  @RequireOrgRole('member')
  async get(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(BriefIdParamSchema)) params: BriefIdParam,
  ): Promise<ApiResponse<BriefResponse>> {
    const data = await this.briefs.get(m.organizationId, params.briefId);
    return { data, message: 'OK', success: true };
  }

  @Get(':briefId/commits')
  @RequireOrgRole('member')
  async getCommits(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(BriefIdParamSchema)) params: BriefIdParam,
    @Query(new ZodValidationPipe(BriefCommitsQuerySchema)) q: BriefCommitsQuery,
  ): Promise<ApiResponse<PaginatedBriefCommits>> {
    const data = await this.briefs.getCommits(
      m.organizationId,
      params.briefId,
      q,
    );
    return { data, message: 'OK', success: true };
  }

  @Get(':briefId/report')
  @RequireOrgRole('member')
  async getReport(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(BriefIdParamSchema)) params: BriefIdParam,
  ): Promise<ApiResponse<BriefReportResponse>> {
    const data = await this.report.build(m.organizationId, params.briefId);
    return { data, message: 'OK', success: true };
  }

  @Delete(':briefId')
  @RequireOrgRole('admin')
  @HttpCode(204)
  async remove(
    @OrgMembership() m: OrgMembershipContext,
    @Param(new ZodValidationPipe(BriefIdParamSchema)) params: BriefIdParam,
  ): Promise<void> {
    await this.briefs.delete(m.organizationId, params.briefId);
  }

  @Post('generate')
  @RequireOrgRole('admin')
  @HttpCode(202)
  async generate(
    @OrgMembership() m: OrgMembershipContext,
    @Body(new ZodValidationPipe(GenerateBriefSchema))
    body: GenerateBriefRequest,
  ): Promise<ApiResponse<GenerateBriefEnqueueResponse>> {
    const data = await this.briefs.generateAdHoc(m.organizationId, body);
    return { data, message: 'Brief generation enqueued', success: true };
  }
}
