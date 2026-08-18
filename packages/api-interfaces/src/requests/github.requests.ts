/**
 * The product ceiling on history, in days. Nothing reads further back than
 * this: not the initial ingest, not a manual repository backfill, not a
 * schedule's brief backfill. Every one of those is billed OpenAI work on
 * first read, so the ceiling is what makes the up-front cost of connecting a
 * repository bounded and quotable.
 */
export const MAX_HISTORY_DAYS = 90;

/** Allowed history windows for the initial ingest, in days. Capped at `MAX_HISTORY_DAYS`. */
export const GITHUB_LOOKBACK_DAYS = [30, 90] as const;

export type GithubLookbackDays = (typeof GITHUB_LOOKBACK_DAYS)[number];

export interface RepositoryBranchSelection {
  repositoryId: string;
  /**
   * The single branch this repository is read on. Write-once: a repository that
   * already has one rejects the request. Omit the repository entirely to leave
   * it unconfigured.
   */
  branch: string;
}

export interface SetRepositoryBranchesRequest {
  lookbackDays: GithubLookbackDays;
  selections: RepositoryBranchSelection[];
}
