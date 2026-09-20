import type { BriefCommitResponse } from './briefs.responses';

/**
 * One page of the org-wide commit list. Items are the same shape a brief's
 * commit list returns, so `CommitRow` renders both without a second mapping.
 */
export interface PaginatedCommits {
  items: BriefCommitResponse[];
  nextCursor: string | null;
}
