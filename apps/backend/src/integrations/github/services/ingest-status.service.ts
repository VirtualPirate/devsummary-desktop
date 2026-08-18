import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import type {
  IngestAnalyzingState,
  IngestFetchingState,
  RepositoryIngestStatus,
  RepositoryIngestStatusResponse,
} from '@launchstack/api-interfaces';
import { KYSELY_DB, type AppDatabase } from '../../../databases/kysely';
import { JOB } from '../../../jobs';
import {
  IngestStatusRepository,
  type RepositoryCountsRow,
  type TrackedRepositoryRow,
} from '../repositories/ingest-status.repository';

/**
 * How long after a branch is chosen a repository with no commits still counts as
 * `pending` rather than finished. A job is enqueued by `setBranches` and claimed
 * a poll later, and its first GitHub page takes seconds more — without this
 * window the onboarding CTA unlocks over an empty history. Bounded because a
 * genuinely empty repository must not lock it forever.
 */
const PENDING_GRACE_MS = 2 * 60_000;

const ORGANIZATION_ID_SCHEMA = z.uuid();

/** Which phase a running job type belongs to, for this screen only. */
const FETCHING_TYPES: string[] = [
  JOB.scanRepository,
  JOB.backfillCommits,
  JOB.ingestNewCommits,
];
const ANALYZING_TYPES: string[] = [JOB.analyzeRepo];

interface RunningPhase {
  startedAt: Date;
}

type RunningByRepository = Map<
  string,
  { fetching?: RunningPhase; analyzing?: RunningPhase }
>;

/**
 * Per-repository ingest progress for the post-connect onboarding console.
 *
 * `jobs/activity` already counts running jobs per phase, but only org-wide —
 * which cannot say *which* repository is slow. This reads `args->>'repositoryId'`
 * off the running rows instead, and filters by job *type* rather than by the
 * `phase` column: collaborator sync is `fetching` too but is not commit
 * ingestion, so filtering by type makes the CTA gate more faithful to its rule
 * than the org-wide counts would be.
 */
@Injectable()
export class IngestStatusService {
  private readonly logger = new Logger(IngestStatusService.name);

  constructor(
    private readonly repo: IngestStatusRepository,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
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
   * One query for the whole org, bucketed by repository. Degrades to "nothing
   * running" on failure — the DB counts still render, and the CTA then unlocks,
   * which is the safe direction: a takeover that can never be dismissed is worse
   * than one dismissed slightly early.
   */
  private async runningByRepository(
    organizationId: string,
  ): Promise<RunningByRepository> {
    const byRepo: RunningByRepository = new Map();

    if (!ORGANIZATION_ID_SCHEMA.safeParse(organizationId).success) {
      this.logger.warn(
        'ingest-status called with a non-uuid organization id; reporting nothing running',
      );
      return byRepo;
    }

    try {
      const rows = await this.db
        .selectFrom('jobs')
        .select([
          'type',
          // There is no `started_at` column: a claimed job runs within one poll
          // of being enqueued, so creation is the start for a progress readout.
          'createdAt',
          sql<string | null>`args ->> 'repositoryId'`.as('repositoryId'),
        ])
        .where('state', '=', 'running')
        .where('organizationId', '=', organizationId)
        .where('type', 'in', [...FETCHING_TYPES, ...ANALYZING_TYPES])
        .execute();

      for (const row of rows) {
        const repositoryId = row.repositoryId;
        if (!repositoryId || !UUID_SCHEMA.safeParse(repositoryId).success) {
          continue;
        }
        const phase = FETCHING_TYPES.includes(row.type)
          ? 'fetching'
          : 'analyzing';

        const entry = byRepo.get(repositoryId) ?? {};
        const existing = entry[phase];
        // Earliest start wins: with a scan and a manual backfill both running,
        // the elapsed time the user cares about is the older one.
        if (!existing || row.createdAt < existing.startedAt) {
          entry[phase] = { startedAt: row.createdAt };
        }
        byRepo.set(repositoryId, entry);
      }
    } catch (err) {
      this.logger.warn(
        `ingest-status jobs query failed; reporting nothing running: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return byRepo;
  }
}

const UUID_SCHEMA = z.uuid();

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
  running: RunningByRepository,
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
