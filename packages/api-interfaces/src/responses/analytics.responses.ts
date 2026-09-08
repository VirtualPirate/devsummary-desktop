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

/** One weekday x hour cell of the commit-hours heatmap. `weekday` is
 * 0 = Monday .. 6 = Sunday, `hour` is 0..23, both resolved in the
 * requested timezone. Only cells with at least one commit are returned. */
export interface CommitHoursCell {
  weekday: number;
  hour: number;
  commits: number;
}

export interface CommitHoursResponse {
  cells: CommitHoursCell[];
  range: { from: string; to: string; timezone: string };
}
