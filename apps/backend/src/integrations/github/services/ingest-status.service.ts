import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Client } from '@temporalio/client';
import { z } from 'zod';
import type {
  IngestAnalyzingState,
  IngestFetchingState,
  RepositoryIngestStatus,
  RepositoryIngestStatusResponse,
} from '@launchstack/api-interfaces';
import { SA_ORG, TEMPORAL_CLIENT, WORKFLOW } from '../../../temporal';
import {
  IngestStatusRepository,
  type RepositoryCountsRow,
  type TrackedRepositoryRow,
} from '../repositories/ingest-status.repository';

/**
 * How long after a branch is chosen a repository with no commits still counts as
 * `pending` rather than finished. Temporal Visibility is eventually consistent, so
 * for a few seconds after `setBranches` the scan workflow is running but invisible
 * to a list query — without this window the onboarding CTA unlocks over an empty
 * history. Bounded because a genuinely empty repository must not lock it forever.
 */
const PENDING_GRACE_MS = 2 * 60_000;

const ORGANIZATION_ID_SCHEMA = z.uuid();

/** Which phase a running workflow type belongs to, for this screen only. */
const FETCHING_TYPES = new Set<string>([
  WORKFLOW.scanRepository,
  WORKFLOW.backfillCommits,
  WORKFLOW.ingestNewCommits,
]);
const ANALYZING_TYPES = new Set<string>([WORKFLOW.analyzeRepo]);

interface RunningPhase {
  startedAt: Date;
}

/**
 * Per-repository ingest progress for the post-connect onboarding console.
 *
 * `jobs/activity` already counts running workflows per phase, but only org-wide —
 * which cannot say *which* repository is slow. Rather than add a `RepositoryId`
 * search attribute, this reads the repository out of the workflow id, which
 * already encodes it: `scan:<repoId>:<branch>`,
 * `backfill:<repoId>:<branch>:<since>`, `analyze:<repoId>:<key>:<force>`.
 * Collaborator sync carries `Phase = fetching` too but is not commit ingestion,
 * so filtering by workflow *type* also makes the CTA gate more faithful to its
 * rule than the org-wide counts would be.
 */
@Injectable()
export class IngestStatusService {
  private readonly logger = new Logger(IngestStatusService.name);

  constructor(
    private readonly repo: IngestStatusRepository,
    @Inject(TEMPORAL_CLIENT) private readonly client: Client,
  ) {}

  async forOrganization(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<RepositoryIngestStatusResponse> {
    const tracked = await this.repo.listTracked(organizationId);
    if (tracked.length === 0) return { repositories: [], ingesting: false };

    const counts = await this.repo.countsFor(
      tracked.map((row) => row.repositoryId),
    );
    const running = await this.runningByRepository(organizationId);

    const repositories = tracked.map((row) =>
      buildStatus(row, counts, running, now),
    );

    return {
      repositories,
      // `incomplete` is excluded on purpose: nothing is running, so waiting on it
      // would never end.
      ingesting: repositories.some(
        (repo) =>
          repo.fetching.state !== 'done' || repo.analyzing.state === 'running',
      ),
    };
  }

  /**
   * One visibility query for the whole org, bucketed by repository. Degrades to
   * "nothing running" on failure — the DB counts still render, and the CTA then
   * unlocks, which is the safe direction: a takeover that can never be dismissed
   * is worse than one dismissed slightly early.
   */
  private async runningByRepository(
    organizationId: string,
  ): Promise<
    Map<string, { fetching?: RunningPhase; analyzing?: RunningPhase }>
  > {
    const byRepo = new Map<
      string,
      { fetching?: RunningPhase; analyzing?: RunningPhase }
    >();

    if (!ORGANIZATION_ID_SCHEMA.safeParse(organizationId).success) {
      this.logger.warn(
        'ingest-status called with a non-uuid organization id; reporting nothing running',
      );
      return byRepo;
    }

    try {
      const query = `${SA_ORG} = '${escapeSa(organizationId)}' AND ExecutionStatus = 'Running'`;
      for await (const execution of this.client.workflow.list({ query })) {
        const type = execution.type;
        const phase = FETCHING_TYPES.has(type)
          ? 'fetching'
          : ANALYZING_TYPES.has(type)
            ? 'analyzing'
            : null;
        if (!phase) continue;

        const repositoryId = repositoryIdFromWorkflowId(execution.workflowId);
        if (!repositoryId) continue;

        const entry = byRepo.get(repositoryId) ?? {};
        const existing = entry[phase];
        // Earliest start wins: with a scan and a manual backfill both running,
        // the elapsed time the user cares about is the older one.
        if (!existing || execution.startTime < existing.startedAt) {
          entry[phase] = { startedAt: execution.startTime };
        }
        byRepo.set(repositoryId, entry);
      }
    } catch (err) {
      this.logger.warn(
        `ingest-status visibility query failed; reporting nothing running: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return byRepo;
  }
}

const ZERO_COUNTS = {
  commitCount: 0,
  processedCount: 0,
  skippedCount: 0,
  failedCount: 0,
} as const;

/** Exported for tests: the whole state machine, with no I/O. */
export function buildStatus(
  row: TrackedRepositoryRow,
  counts: RepositoryCountsRow[],
  running: Map<string, { fetching?: RunningPhase; analyzing?: RunningPhase }>,
  now: Date,
): RepositoryIngestStatus {
  const count =
    counts.find((c) => c.repositoryId === row.repositoryId) ?? ZERO_COUNTS;
  const live = running.get(row.repositoryId) ?? {};

  const withinGrace =
    now.getTime() - row.trackedSince.getTime() < PENDING_GRACE_MS;

  const fetchingState: IngestFetchingState = live.fetching
    ? 'running'
    : count.commitCount === 0 && withinGrace
      ? 'pending'
      : 'done';

  const fetchingOngoing = fetchingState !== 'done';
  const analyzingState: IngestAnalyzingState = live.analyzing
    ? 'running'
    : count.commitCount === 0
      ? 'waiting'
      : count.processedCount >= count.commitCount
        ? fetchingOngoing
          ? 'caughtUp'
          : 'done'
        : fetchingOngoing
          ? 'waiting'
          : 'incomplete';

  return {
    repositoryId: row.repositoryId,
    fullName: row.fullName,
    branch: row.branch,
    fetching: {
      state: fetchingState,
      startedAt: live.fetching?.startedAt.toISOString() ?? null,
    },
    analyzing: {
      state: analyzingState,
      startedAt: live.analyzing?.startedAt.toISOString() ?? null,
    },
    commitCount: count.commitCount,
    processedCount: count.processedCount,
    skippedCount: count.skippedCount,
    failedCount: count.failedCount,
  };
}

/**
 * `scan:<repoId>:<branch>` / `backfill:<repoId>:<branch>:<since>` /
 * `push:<repoId>:<branch>:<headSha>` / `sweep:<repoId>:<branch>:<runDate>` /
 * `analyze:<repoId>:<key>:<force>`. Only the second segment is read, and only
 * when it is a UUID — an unrecognised id shape yields `null` rather than a bogus
 * repository key.
 */
const WORKFLOW_ID_PREFIXES = ['scan', 'backfill', 'push', 'sweep', 'analyze'];
const UUID_SCHEMA = z.uuid();

export function repositoryIdFromWorkflowId(workflowId: string): string | null {
  const parts = workflowId.split(':');
  if (parts.length < 2) return null;
  if (!WORKFLOW_ID_PREFIXES.includes(parts[0])) return null;
  return UUID_SCHEMA.safeParse(parts[1]).success ? parts[1] : null;
}

// orgId is a UUID from our own guard, but escape single quotes defensively.
function escapeSa(v: string): string {
  return v.replace(/'/g, "''");
}
