export type GithubAccountType = 'User' | 'Organization';

export interface GithubRepository {
  id: string;
  githubRepoId: string;
  name: string;
  fullName: string;
  private: boolean;
  /**
   * The branch this repository is read on. `null` = not configured, repo is
   * inert (nothing fetched, analyzed, or reported).
   */
  branch: string | null;
}

export interface GithubBranch {
  name: string;
  isDefault: boolean;
  /** ISO timestamp of the branch head's commit, or `null` if unknown. */
  lastCommitAt: string | null;
}

export interface ListRepositoryBranchesResponse {
  branches: GithubBranch[];
  defaultBranch: string | null;
  /** True when the branch list was capped — filter server-side is not offered. */
  truncated: boolean;
}

export interface SetRepositoryBranchesResponse {
  /** One per repository whose ingestion started, in request order. */
  jobIds: string[];
  started: number;
}

export interface GithubInstallation {
  id: string;
  githubInstallationId: string;
  accountLogin: string;
  accountType: GithubAccountType;
  accountAvatarUrl: string | null;
  suspendedAt: string | null;
  connectedByUserId: string | null;
  createdAt: string;
}

export interface GithubInstallationWithRepos extends GithubInstallation {
  repositories: GithubRepository[];
}

export interface CommitBackfillEnqueueResponse {
  jobId: string;
}

export interface CommitAnalysisEnqueueResponse {
  jobId: string;
  expectedCommitCount: number;
}

/**
 * `pending` covers the gap between choosing a branch and Temporal Visibility
 * reporting the workflow — without it the onboarding CTA unlocks for a few
 * seconds over an empty history.
 */
export type IngestFetchingState = 'pending' | 'running' | 'done';

/**
 * `caughtUp` — analysis has processed everything fetched so far and is idle while
 * more arrives. `incomplete` — nothing is running but commits remain unprocessed,
 * which is what a permanently failed analysis looks like; it deliberately does
 * **not** hold the CTA, or one dead commit would lock onboarding forever.
 */
export type IngestAnalyzingState =
  | 'waiting'
  | 'running'
  | 'caughtUp'
  | 'incomplete'
  | 'done';

export interface IngestPhaseStatus<S> {
  state: S;
  /**
   * ISO start time of the workflow behind a `running` state, else `null`. The
   * client derives elapsed time and the stalled threshold from this — there is
   * no server-side "stalled" flag.
   */
  startedAt: string | null;
}

export interface RepositoryIngestStatus {
  repositoryId: string;
  fullName: string;
  /** The branch this repository is read on. Never null here — untracked repositories are omitted. */
  branch: string;
  fetching: IngestPhaseStatus<IngestFetchingState>;
  analyzing: IngestPhaseStatus<IngestAnalyzingState>;
  /** Commits pulled onto `branch` so far. No total exists until fetching finishes. */
  commitCount: number;
  /** Commits with an analysis row of any status — i.e. processed. */
  processedCount: number;
  /** Of `processedCount`: merge/empty commits deliberately not summarized. */
  skippedCount: number;
  /** Of `processedCount`: analyses that exhausted their retries. */
  failedCount: number;
}

export interface RepositoryIngestStatusResponse {
  repositories: RepositoryIngestStatus[];
  /**
   * True while any repository is still fetching (or pending) or analyzing. The
   * one value the onboarding CTA gates on, computed here so the client doesn't
   * re-derive the rule. Brief generation is excluded by construction — gating on
   * it would deadlock the button against the backfill its own schedule starts.
   */
  ingesting: boolean;
}
