import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { MAX_HISTORY_DAYS } from '@launchstack/api-interfaces';
import type {
  ApiResponse,
  CommitAnalysisEnqueueResponse,
  CommitBackfillEnqueueResponse,
} from '@launchstack/api-interfaces';
import { AppError } from '../../../../common/errors';
import {
  OrgMembership,
  type OrgMembershipContext,
} from '../../../../organizations/decorators/org-membership.decorator';
import { RequireOrgRole } from '../../../../organizations/decorators/require-org-role.decorator';
import { ZodValidationPipe } from '../../../../organizations/dto/zod-validation.pipe';
import {
  TemporalProducerService,
  WORKFLOW,
  buildSearchAttributes,
} from '../../../../temporal';
import { GithubRepositoriesRepository } from '../../repositories/repositories.repository';
import { RepositoryBranchesRepository } from '../../repositories/repository-branches.repository';
import {
  AnalyzeBodySchema,
  BackfillBodySchema,
  RepositoryIdParamSchema,
  type AnalyzeBody,
  type BackfillBody,
} from '../dto/commit-analysis.dto';
import { CommitsRepository } from '../repositories/commits.repository';

const DEFAULT_BACKFILL_DAYS = MAX_HISTORY_DAYS;

/**
 * The window *and* the dedup key for it, from one place — keying on the raw
 * `days` input instead let a 90-day request collapse onto a Running 7-day run
 * via `USE_EXISTING`, returning 202 for history that never got ingested.
 *
 * The key buckets `since` to its UTC date: a full timestamp changes every
 * millisecond and would defeat dedup entirely, a coarser bucket would serve a
 * window up to a month stale. The cost is that two same-`days` requests whose
 * `since` boundaries straddle UTC midnight each get their own run.
 */
function resolveWindow(days: number): { sinceISO: string; dedupKey: string } {
  const sinceISO = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();
  return { sinceISO, dedupKey: sinceISO.slice(0, 10) };
}

@Controller('api/integrations/github/repositories/:repoId/commits')
export class CommitAnalysisController {
  constructor(
    private readonly repos: GithubRepositoriesRepository,
    private readonly commits: CommitsRepository,
    private readonly temporal: TemporalProducerService,
    private readonly trackedBranches: RepositoryBranchesRepository,
  ) {}

  @Post('backfill')
  @RequireOrgRole('admin')
  @HttpCode(202)
  async backfill(
    @OrgMembership() membership: OrgMembershipContext,
    @Param(new ZodValidationPipe(RepositoryIdParamSchema))
    params: { repoId: string },
    @Body(new ZodValidationPipe(BackfillBodySchema)) body: BackfillBody,
  ): Promise<ApiResponse<CommitBackfillEnqueueResponse>> {
    const repo = await this.repos.findByIdScopedToOrg(
      params.repoId,
      membership.organizationId,
    );
    if (!repo) throw AppError.GITHUB_REPOSITORY_NOT_FOUND();

    const { sinceISO, dedupKey } = resolveWindow(
      body.days ?? DEFAULT_BACKFILL_DAYS,
    );

    // One backfill per tracked branch. A repository with no tracked branch is
    // inert by design, so this refuses rather than picking a branch for the
    // caller — the same rule the ingest activity enforces.
    const branches = body.branch
      ? [body.branch]
      : await this.trackedBranches.listByRepository(repo.id);
    if (branches.length === 0) {
      throw AppError.GITHUB_REPOSITORY_BRANCH_NOT_CONFIGURED();
    }

    const jobIds: string[] = [];
    for (const branch of branches) {
      const jobId = await this.temporal.startDeduped(WORKFLOW.backfillCommits, {
        workflowId: `backfill:${repo.id}:${branch}:${dedupKey}`,
        args: [
          {
            repositoryId: repo.id,
            branch,
            sinceISO,
            organizationId: membership.organizationId,
          },
        ],
        searchAttributes: buildSearchAttributes({
          organizationId: membership.organizationId,
          phase: 'fetching',
        }),
      });
      jobIds.push(jobId);
    }

    return {
      // One job per branch; the response contract is a single id, so report the
      // first and keep the rest in the log-visible workflow ids.
      data: { jobId: jobIds[0] ?? 'duplicate' },
      message: 'OK',
      success: true,
    };
  }

  @Post('analyze')
  @RequireOrgRole('admin')
  @HttpCode(202)
  async analyze(
    @OrgMembership() membership: OrgMembershipContext,
    @Param(new ZodValidationPipe(RepositoryIdParamSchema))
    params: { repoId: string },
    @Body(new ZodValidationPipe(AnalyzeBodySchema)) body: AnalyzeBody,
  ): Promise<ApiResponse<CommitAnalysisEnqueueResponse>> {
    const repo = await this.repos.findByIdScopedToOrg(
      params.repoId,
      membership.organizationId,
    );
    if (!repo) throw AppError.GITHUB_REPOSITORY_NOT_FOUND();

    const { sinceISO, dedupKey } = resolveWindow(body.days);
    const force = body.force ?? false;
    const expectedCommitCount = await this.commits.countByRepositorySince(
      repo.id,
      sinceISO,
    );

    const jobId = await this.temporal.startDeduped(WORKFLOW.analyzeRepo, {
      workflowId: `analyze:${repo.id}:${dedupKey}:${force}`,
      args: [
        {
          repositoryId: repo.id,
          sinceISO,
          force,
          organizationId: membership.organizationId,
        },
      ],
      searchAttributes: buildSearchAttributes({
        organizationId: membership.organizationId,
        phase: 'analyzing',
      }),
    });

    return {
      data: {
        jobId: jobId ?? 'duplicate',
        expectedCommitCount,
      },
      message: 'OK',
      success: true,
    };
  }
}
