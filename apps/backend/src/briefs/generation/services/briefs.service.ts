import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  BriefResponse,
  BriefCommitResponse,
  BriefCommitsQuery,
  BriefCommitType,
  BriefCommitTypeCounts,
  BriefPreviewQuery,
  BriefPreviewResponse,
  GenerateBriefEnqueueResponse,
  GenerateBriefRequest,
  ListBriefsQuery,
  PaginatedBriefs,
  PaginatedBriefCommits,
} from '@launchstack/api-interfaces';
import { BRIEF_COMMIT_TYPES } from '@launchstack/api-interfaces';
import { AppError } from '../../../common/errors';
import { isIanaTimeZone } from '../../../analytics/lib/timezone-aliases';
import { JOB, JobQueueService } from '../../../jobs';
import { CollaboratorsRepository } from '../../../integrations/github/collaborators/repositories/collaborators.repository';
import { GithubRepositoriesRepository } from '../../../integrations/github/repositories/repositories.repository';
import { RepositoryBranchesRepository } from '../../../integrations/github/repositories/repository-branches.repository';
import { IngestStatusService } from '../../../integrations/github/services/ingest-status.service';
import { ProjectsRepository } from '../../projects/repositories/projects.repository';
import { TeamsRepository } from '../../teams/repositories/teams.repository';
import { BriefsRepository } from '../repositories/briefs.repository';
import { BriefCommitsRepository } from '../repositories/brief-commits.repository';
import type { BriefCommitRow } from '../repositories/brief-commits.repository';
import { BriefReportRepository } from '../repositories/brief-report.repository';
import { BriefDelivererService } from '../../delivery/services/brief-deliverer.service';
import { BriefScopeResolver } from './brief-scope.resolver';
import type { BriefSelect } from '../../../databases/kysely';

const CURSOR_SCHEMA = z.object({
  periodEnd: z.iso.datetime(),
  id: z.uuid(),
});

/** How far back the preview looks for an already-generated brief to warn about. */
const RECENT_BRIEF_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BriefsService {
  constructor(
    private readonly briefs: BriefsRepository,
    private readonly briefCommits: BriefCommitsRepository,
    private readonly projects: ProjectsRepository,
    private readonly teams: TeamsRepository,
    private readonly collaborators: CollaboratorsRepository,
    private readonly repos: GithubRepositoriesRepository,
    private readonly trackedBranches: RepositoryBranchesRepository,
    private readonly queue: JobQueueService,
    private readonly scopes: BriefScopeResolver,
    private readonly report: BriefReportRepository,
    private readonly deliverer: BriefDelivererService,
    // Appended, not inserted: the unit specs pass positional `null as never`
    // deps, so a mid-list parameter silently reassigns every later one.
    private readonly ingestStatus: IngestStatusService,
  ) {}

  async list(
    organizationId: string,
    q: ListBriefsQuery,
  ): Promise<PaginatedBriefs> {
    const cursor = q.cursor ? this.decodeCursor(q.cursor) : null;
    const rows = await this.briefs.list({
      organizationId,
      scheduleId: q.scheduleId,
      scopeType: q.scopeType,
      scopeProjectId: q.scopeProjectId,
      scopeTeamId: q.scopeTeamId,
      scopeCollaboratorId: q.scopeCollaboratorId,
      scopeRepositoryId: q.scopeRepositoryId,
      periodEndFrom: q.from ? new Date(q.from) : undefined,
      periodEndTo: q.to ? new Date(q.to) : undefined,
      excludeNoActivity: q.excludeNoActivity,
      limit: q.limit + 1,
      cursorPeriodEnd: cursor?.periodEnd,
      cursorId: cursor?.id,
    });
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const nextCursor = hasMore
      ? this.encodeCursor({
          periodEnd: page[page.length - 1].periodEnd,
          id: page[page.length - 1].id,
        })
      : null;
    const countsByBrief = await this.fetchTypeCounts(page.map((r) => r.id));
    return {
      items: page.map((r) =>
        this.toResponse(r, countsByBrief.get(r.id) ?? this.emptyTypeCounts()),
      ),
      nextCursor,
    };
  }

  async get(organizationId: string, briefId: string): Promise<BriefResponse> {
    const row = await this.briefs.findByIdScopedToOrg(briefId, organizationId);
    if (!row) throw AppError.BRIEF_NOT_FOUND();
    const countsByBrief = await this.fetchTypeCounts([row.id]);
    return this.toResponse(
      row,
      countsByBrief.get(row.id) ?? this.emptyTypeCounts(),
    );
  }

  async getCommits(
    organizationId: string,
    briefId: string,
    q: BriefCommitsQuery,
  ): Promise<PaginatedBriefCommits> {
    const brief = await this.briefs.findByIdScopedToOrg(
      briefId,
      organizationId,
    );
    if (!brief) throw AppError.BRIEF_NOT_FOUND();

    const cursor = q.cursor ? this.decodeCommitCursor(q.cursor) : null;
    const [rows, contributors] = await Promise.all([
      this.briefCommits.listForBrief({
        briefId,
        limit: q.limit + 1,
        cursorAuthoredAt: cursor?.authoredAt,
        cursorId: cursor?.id,
        contributor: q.contributor,
        commitType: q.commitType,
      }),
      this.briefCommits.listContributorsForBrief(briefId),
    ]);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? this.encodeCommitCursor({
            authoredAt: last.authoredAt ? last.authoredAt.toISOString() : null,
            id: last.briefCommitId,
          })
        : null;

    return {
      items: page.map((r) => this.toCommitResponse(r)),
      nextCursor,
      contributors,
    };
  }

  private toCommitResponse(r: BriefCommitRow): BriefCommitResponse {
    const githubUrl =
      r.repositoryFullName && r.sha
        ? `https://github.com/${r.repositoryFullName}/commit/${r.sha}`
        : null;
    const analysis =
      r.analysisStatus === 'analyzed' && r.analysisCommitType
        ? {
            commitType: r.analysisCommitType,
            summary: r.analysisSummary ?? '',
            changes: r.analysisChanges ?? [],
          }
        : null;
    return {
      sha: r.sha,
      commitId: r.commitId,
      repositoryFullName: r.repositoryFullName,
      authorName: r.authorName,
      authorLogin: r.authorLogin,
      messageFirstLine: r.message ? r.message.split('\n', 1)[0] : null,
      authoredAt: r.authoredAt ? r.authoredAt.toISOString() : null,
      githubUrl,
      analysis,
    };
  }

  private encodeCommitCursor(c: {
    authoredAt: string | null;
    id: string;
  }): string {
    return Buffer.from(JSON.stringify(c)).toString('base64url');
  }

  private decodeCommitCursor(s: string): {
    authoredAt: Date | null;
    id: string;
  } {
    try {
      const obj = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as {
        authoredAt: string | null;
        id: string;
      };
      return {
        authoredAt: obj.authoredAt ? new Date(obj.authoredAt) : null,
        id: obj.id,
      };
    } catch {
      throw AppError.BAD_REQUEST({ message: 'Invalid cursor' });
    }
  }

  async generateAdHoc(
    organizationId: string,
    body: GenerateBriefRequest,
  ): Promise<GenerateBriefEnqueueResponse> {
    const now = new Date();
    const periodStart = body.periodStart
      ? new Date(body.periodStart)
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const periodEnd = body.periodEnd ? new Date(body.periodEnd) : now;
    if (periodEnd.getTime() <= periodStart.getTime()) {
      throw AppError.BRIEF_INVALID_PERIOD({
        reason: 'periodEnd must be after periodStart',
      });
    }
    // Validated at the boundary rather than trusted: this lands in
    // `period_timezone`, which every later render and the report's day tiling
    // read, so an offset string like '+05:30' would poison the row for good.
    if (body.timezone && !isIanaTimeZone(body.timezone)) {
      throw AppError.BRIEF_SCHEDULE_INVALID_TIMEZONE({
        timezone: body.timezone,
      });
    }

    // Same rule, same source, as the schedule create gate: a brief written now
    // would summarize a history still being read, and nothing rewrites a brief.
    // Degrades to allowed when the ingest query fails, so an unreachable
    // dependency cannot lock generation outright.
    const ingest = await this.ingestStatus.forOrganization(organizationId);
    if (ingest.ingesting) throw AppError.BRIEF_COMMITS_PROCESSING();

    await this.assertScopeInOrg(organizationId, body.scope);

    const briefRow = await this.briefs.create({
      organizationId,
      briefScheduleId: null,
      scopeType: body.scope.type,
      scopeProjectId:
        body.scope.type === 'project' ? body.scope.projectId : null,
      scopeTeamId: body.scope.type === 'team' ? body.scope.teamId : null,
      scopeCollaboratorId:
        body.scope.type === 'collaborator' ? body.scope.collaboratorId : null,
      scopeRepositoryId:
        body.scope.type === 'repository' ? body.scope.repositoryId : null,
      scopeBranch:
        body.scope.type === 'repository' ? (body.scope.branch ?? null) : null,
      periodStart,
      periodEnd,
      // The caller's zone, so the report tiles its days and prints its label
      // the way the person who asked for it reads dates. UTC only when the
      // request names none.
      periodTimezone: body.timezone ?? 'UTC',
      // A brief covers what arrived on the tracked branch during the period.
      // Not a git date: a merge commit backdates neither of those, so work
      // merged today would select into a period already reported on.
      commitClock: 'landed',
      status: 'pending',
    });

    const jobId = await this.queue.enqueue(
      JOB.generateBrief,
      { briefId: briefRow.id, organizationId },
      { id: `brief:${briefRow.id}`, phase: 'generating', organizationId },
    );
    return { briefId: briefRow.id, jobId };
  }

  /**
   * Soft-deletes a hand-generated brief. Scheduled briefs are refused: the
   * schedule would recreate the period on the next backfill, and
   * `briefs_schedule_period_active_unique` only covers live rows — so a delete
   * here reads as "gone" while the dispatcher is free to make it again.
   *
   * An in-flight brief needs no extra handling: every activity re-reads it
   * through `findById`, which filters `deleted_at`, so the workflow exits.
   */
  async delete(organizationId: string, briefId: string): Promise<void> {
    const row = await this.briefs.findByIdScopedToOrg(briefId, organizationId);
    if (!row) throw AppError.BRIEF_NOT_FOUND();
    if (row.briefScheduleId) throw AppError.BRIEF_NOT_DELETABLE();
    await this.briefs.softDelete(briefId);
  }

  /**
   * What a scope + period holds before anything is generated. Read-only, and
   * counted through the generator's own predicate — a number here that
   * disagreed with the brief that follows would be worse than no number.
   */
  async preview(
    organizationId: string,
    q: BriefPreviewQuery,
  ): Promise<BriefPreviewResponse> {
    const scope = this.scopeFromQuery(q);
    const periodStart = new Date(q.periodStart);
    const periodEnd = new Date(q.periodEnd);
    if (periodEnd.getTime() <= periodStart.getTime()) {
      throw AppError.BRIEF_INVALID_PERIOD({
        reason: 'periodEnd must be after periodStart',
      });
    }

    // Same boundary checks as generate: previewing a scope the generate call
    // would reject should fail the same way, not quietly show zero.
    await this.assertScopeInOrg(organizationId, scope);
    const resolved = await this.scopes.resolve({ organizationId, scope });
    const entity = {
      repositoryIds: resolved.repositoryIds,
      authorFilter: resolved.authorFilter,
      branchFilter: resolved.branchFilter,
      // No brief row to read a snapshot off yet — this previews the brief that
      // pressing Generate would create, and that one is written 'landed'.
      commitClock: 'landed' as const,
    };
    const window = { ...entity, from: periodStart, to: periodEnd };

    const [totals, typeRows, bounds, recent] = await Promise.all([
      this.report.previewTotals(window),
      this.report.previewTypeBuckets(window),
      this.report.scopeBounds(entity),
      this.briefs.findMostRecentForScope({
        organizationId,
        scopeType: scope.type,
        scopeProjectId: scope.type === 'project' ? scope.projectId : null,
        scopeTeamId: scope.type === 'team' ? scope.teamId : null,
        scopeCollaboratorId:
          scope.type === 'collaborator' ? scope.collaboratorId : null,
        scopeRepositoryId:
          scope.type === 'repository' ? scope.repositoryId : null,
        createdAfter: new Date(Date.now() - RECENT_BRIEF_WINDOW_MS),
      }),
    ]);

    const commitTypeCounts = this.emptyTypeCounts();
    let analyzed = 0;
    for (const row of typeRows) {
      if (row.commitType) analyzed += row.commits;
      const key: BriefCommitType =
        row.commitType &&
        (BRIEF_COMMIT_TYPES as readonly string[]).includes(row.commitType)
          ? (row.commitType as BriefCommitType)
          : 'unclassified';
      commitTypeCounts[key] += row.commits;
    }

    return {
      scopeLabel: resolved.scopeLabel,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      commits: totals.commits,
      contributors: totals.contributors,
      repositories: totals.repositories,
      analyzed,
      commitTypeCounts,
      historyFrom: bounds.earliest ? bounds.earliest.toISOString() : null,
      historyTo: bounds.latest ? bounds.latest.toISOString() : null,
      recentBrief: recent
        ? {
            id: recent.id,
            periodStart: recent.periodStart.toISOString(),
            periodEnd: recent.periodEnd.toISOString(),
            periodTimezone: recent.periodTimezone,
            createdAt: recent.createdAt.toISOString(),
          }
        : null,
    };
  }

  /**
   * The preview is a GET, so its scope arrives flattened the way
   * `ListBriefsQuerySchema` flattens it. The schema's `refine` already
   * guarantees the matching id is present.
   */
  private scopeFromQuery(q: BriefPreviewQuery): GenerateBriefRequest['scope'] {
    if (q.scopeType === 'project')
      return { type: 'project', projectId: q.scopeProjectId as string };
    if (q.scopeType === 'team')
      return { type: 'team', teamId: q.scopeTeamId as string };
    if (q.scopeType === 'collaborator')
      return {
        type: 'collaborator',
        collaboratorId: q.scopeCollaboratorId as string,
      };
    return {
      type: 'repository',
      repositoryId: q.scopeRepositoryId as string,
      branch: q.branch,
    };
  }

  private async assertScopeInOrg(
    organizationId: string,
    scope: GenerateBriefRequest['scope'],
  ): Promise<void> {
    if (scope.type === 'project') {
      if (
        !(await this.projects.findByIdScopedToOrg(
          scope.projectId,
          organizationId,
        ))
      ) {
        throw AppError.PROJECT_NOT_FOUND();
      }
    } else if (scope.type === 'team') {
      if (
        !(await this.teams.findByIdScopedToOrg(scope.teamId, organizationId))
      ) {
        throw AppError.TEAM_NOT_FOUND();
      }
    } else if (scope.type === 'collaborator') {
      if (
        !(await this.collaborators.findByIdScopedToOrg(
          scope.collaboratorId,
          organizationId,
        ))
      ) {
        throw AppError.GITHUB_COLLABORATOR_NOT_FOUND();
      }
    } else {
      if (
        !(await this.repos.findByIdScopedToOrg(
          scope.repositoryId,
          organizationId,
        ))
      ) {
        throw AppError.GITHUB_REPOSITORY_NOT_FOUND();
      }
      await this.assertRepositoryIsRead(scope.repositoryId, scope.branch);
    }
  }

  /**
   * A repository that tracks no branch reads nothing, so a brief scoped to it
   * can only ever come back empty — and a branch outside the tracked set is the
   * same thing with a plausible-looking name. Refuse at the boundary instead of
   * generating "no activity" and leaving the user to guess why.
   */
  private async assertRepositoryIsRead(
    repositoryId: string,
    branch: string | undefined,
  ): Promise<void> {
    const tracked = await this.trackedBranches.listByRepository(repositoryId);
    if (tracked.length === 0) {
      throw AppError.GITHUB_REPOSITORY_BRANCH_NOT_CONFIGURED();
    }
    if (branch && !tracked.includes(branch)) {
      throw AppError.GITHUB_REPOSITORY_BRANCH_NOT_TRACKED({ branch });
    }
  }

  private encodeCursor(c: { periodEnd: Date; id: string }): string {
    return Buffer.from(
      JSON.stringify({ periodEnd: c.periodEnd.toISOString(), id: c.id }),
    ).toString('base64url');
  }

  private decodeCursor(s: string): { periodEnd: Date; id: string } {
    try {
      // The payload is shape-checked, not just parsed: `id` goes into
      // `WHERE id < $1` against a uuid column, so a well-formed base64url
      // cursor carrying a non-uuid id would otherwise reach Postgres and come
      // back as 22P02 — an unknown error the filter can only turn into a 500.
      const obj = CURSOR_SCHEMA.parse(
        JSON.parse(Buffer.from(s, 'base64url').toString('utf8')),
      );
      return { periodEnd: new Date(obj.periodEnd), id: obj.id };
    } catch {
      throw AppError.BAD_REQUEST({ message: 'Invalid cursor' });
    }
  }

  private async fetchTypeCounts(
    briefIds: string[],
  ): Promise<Map<string, BriefCommitTypeCounts>> {
    const rows = await this.briefCommits.countTypesForBriefs(briefIds);
    const byBrief = new Map<string, BriefCommitTypeCounts>();
    for (const row of rows) {
      let counts = byBrief.get(row.briefId);
      if (!counts) {
        counts = this.emptyTypeCounts();
        byBrief.set(row.briefId, counts);
      }
      const key: BriefCommitType =
        row.commitType &&
        (BRIEF_COMMIT_TYPES as readonly string[]).includes(row.commitType)
          ? (row.commitType as BriefCommitType)
          : 'unclassified';
      counts[key] += row.count;
    }
    return byBrief;
  }

  private emptyTypeCounts(): BriefCommitTypeCounts {
    return Object.fromEntries(
      BRIEF_COMMIT_TYPES.map((t) => [t, 0]),
    ) as BriefCommitTypeCounts;
  }

  private toResponse(
    row: BriefSelect,
    commitTypeCounts: BriefCommitTypeCounts,
  ): BriefResponse {
    return {
      id: row.id,
      organizationId: row.organizationId,
      briefScheduleId: row.briefScheduleId,
      scope:
        row.scopeType === 'project'
          ? { type: 'project', projectId: row.scopeProjectId }
          : row.scopeType === 'team'
            ? { type: 'team', teamId: row.scopeTeamId }
            : row.scopeType === 'collaborator'
              ? {
                  type: 'collaborator',
                  collaboratorId: row.scopeCollaboratorId,
                }
              : {
                  type: 'repository',
                  repositoryId: row.scopeRepositoryId,
                  ...(row.scopeBranch ? { branch: row.scopeBranch } : {}),
                },
      title: row.title,
      briefInfoTitle: row.briefInfoTitle,
      summary: row.summary,
      highlights: row.highlights,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      periodTimezone: row.periodTimezone,
      contributorCount: row.contributorCount,
      commitCount: row.commitCount,
      commitTypeCounts,
      status: row.status,
      failureReason: row.failureReason,
      generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      deliveredChannels: row.deliveredChannels,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
