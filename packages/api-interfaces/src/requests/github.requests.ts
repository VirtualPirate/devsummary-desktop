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

/** Body of `POST /api/integrations/github/token`. */
export interface ConnectGithubTokenRequest {
  /** A GitHub fine-grained personal access token. Validated server-side. */
  token: string;
}

/** Where the user creates the token the settings screen asks for. */
export const GITHUB_PAT_CREATE_URL =
  "https://github.com/settings/personal-access-tokens/new";

/**
 * What the token must grant, for the connect screen to display verbatim.
 * Fine-grained token, scoped to the repositories the user wants briefed.
 *
 * Nothing here is a classic-token scope: `repo` would work but grants write
 * access, and DevSummary only ever reads.
 *
 * `reason` is row copy, not prose: it sits beside the name and the access chip
 * in a column that can be 390px wide, so a sentence would push the whole row
 * onto a third line. `permission` keeps the full path because it is the only
 * thing telling the user *where* on GitHub's token page to look.
 */
export const GITHUB_PAT_PERMISSIONS = [
  {
    permission: "Repository permissions → Contents",
    access: "Read-only",
    required: true,
    reason: "Commits and diffs.",
  },
  {
    permission: "Repository permissions → Metadata",
    access: "Read-only",
    required: true,
    reason: "Added by GitHub.",
  },
  {
    permission: "Organization permissions → Members",
    access: "Read-only",
    required: false,
    reason: "Org collaborators.",
  },
] as const;

export type GithubPatPermission = (typeof GITHUB_PAT_PERMISSIONS)[number];
