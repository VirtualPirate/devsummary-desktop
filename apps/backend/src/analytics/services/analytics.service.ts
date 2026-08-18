import { Injectable } from '@nestjs/common';
import type {
  BriefCommitTypeCounts,
  CommitActivityPoint,
  CommitActivityResponse,
  GetCommitActivityQuery,
} from '@launchstack/api-interfaces';
import { AppError } from '../../common/errors';
import { CollaboratorsRepository } from '../../integrations/github/collaborators/repositories/collaborators.repository';
import {
  BucketLimitExceededError,
  enumerateBucketKeys,
} from '../lib/activity-buckets';
import { normalizeIanaTimeZone } from '../lib/timezone-aliases';
import {
  CommitActivityRepository,
  type CommitActivityRow,
} from '../repositories/commit-activity.repository';

const MAX_BUCKETS = 800;

const TYPE_KEYS = [
  'feature',
  'fix',
  'optimization',
  'refactor',
  'docs',
  'test',
  'chore',
] as const;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly activity: CommitActivityRepository,
    private readonly collaborators: CollaboratorsRepository,
  ) {}

  async getCommitActivity(
    organizationId: string,
    q: GetCommitActivityQuery,
  ): Promise<CommitActivityResponse> {
    const from = new Date(q.from);
    const to = new Date(q.to);
    // Browsers may report CLDR-legacy zone ids (Asia/Calcutta) that
    // Postgres does not recognize; bucket keys and SQL must agree on
    // the same normalized id.
    const timezone = normalizeIanaTimeZone(q.timezone);

    let keys: string[];
    try {
      keys = enumerateBucketKeys(
        from,
        to,
        q.granularity,
        timezone,
        MAX_BUCKETS,
      );
    } catch (err) {
      if (err instanceof BucketLimitExceededError) {
        throw AppError.ANALYTICS_RANGE_TOO_LARGE();
      }
      throw err;
    }

    let authorGithubUserId: bigint | undefined;
    if (q.collaboratorId) {
      const collaborator = await this.collaborators.findByIdScopedToOrg(
        q.collaboratorId,
        organizationId,
      );
      if (!collaborator) throw AppError.GITHUB_COLLABORATOR_NOT_FOUND();
      authorGithubUserId = collaborator.githubUserId;
    }

    const rows = await this.activity.aggregate({
      organizationId,
      from,
      to,
      granularity: q.granularity,
      timezone,
      repositoryId: q.repositoryId,
      authorGithubUserId,
    });

    const byBucket = new Map(rows.map((r) => [r.bucket, r]));
    const points = keys.map((date) => toPoint(date, byBucket.get(date)));

    return {
      points,
      range: {
        from: q.from,
        to: q.to,
        granularity: q.granularity,
        timezone,
      },
    };
  }
}

function toPoint(
  date: string,
  row: CommitActivityRow | undefined,
): CommitActivityPoint {
  const byType: BriefCommitTypeCounts = {
    feature: row?.feature ?? 0,
    fix: row?.fix ?? 0,
    optimization: row?.optimization ?? 0,
    refactor: row?.refactor ?? 0,
    docs: row?.docs ?? 0,
    test: row?.test ?? 0,
    chore: row?.chore ?? 0,
    unclassified: 0,
  };
  const commits = row?.commits ?? 0;
  const typedTotal = TYPE_KEYS.reduce((sum, k) => sum + byType[k], 0);
  byType.unclassified = commits - typedTotal;
  return {
    date,
    commits,
    additions: row?.additions ?? 0,
    deletions: row?.deletions ?? 0,
    byType,
  };
}
