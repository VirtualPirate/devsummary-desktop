import type { CommitActivityGranularity } from '../requests/analytics.requests';
import type { BriefCommitTypeCounts } from './briefs.responses';

/** One time bucket of commit activity. `date` is the bucket start
 * (YYYY-MM-DD) in the requested timezone. Buckets are contiguous,
 * zero-filled, and ascending. */
export interface CommitActivityPoint {
  date: string;
  commits: number;
  additions: number;
  deletions: number;
  byType: BriefCommitTypeCounts;
}

export interface CommitActivityRange {
  from: string;
  to: string;
  granularity: CommitActivityGranularity;
  timezone: string;
}

export interface CommitActivityResponse {
  points: CommitActivityPoint[];
  range: CommitActivityRange;
}
