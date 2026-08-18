export type BriefScopeType =
  | 'project'
  | 'team'
  | 'collaborator'
  | 'repository';

export type BriefCadenceType = 'daily' | 'weekly' | 'monthly';

export type BriefStatus =
  | 'pending'
  | 'generating'
  | 'generated'
  | 'delivered'
  | 'failed';

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  color: string | null;
  repositoryIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  color: string | null;
  collaboratorIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BriefScheduleResponse {
  id: string;
  organizationId: string;
  name: string;
  cadence:
    | { type: 'daily'; time: string }
    | { type: 'weekly'; time: string; dayOfWeek: number }
    | { type: 'monthly'; time: string; dayOfMonth: number };
  timezone: string;
  scope:
    | { type: 'project'; projectId: string }
    | { type: 'team'; teamId: string }
    | { type: 'collaborator'; collaboratorId: string }
    | { type: 'repository'; repositoryId: string; branch?: string };
  paused: boolean;
  nextRunAt: string;
  lastSentAt: string | null;
  delivery: {
    emails: string[];
    slackChannelId: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export const BRIEF_COMMIT_TYPES = [
  'feature',
  'fix',
  'optimization',
  'refactor',
  'docs',
  'test',
  'chore',
  'unclassified',
] as const;

export type BriefCommitType = (typeof BRIEF_COMMIT_TYPES)[number];

/**
 * Commit counts per type for a brief. All keys are always present (zeros
 * included); percentages are derived client-side from these counts.
 */
export type BriefCommitTypeCounts = Record<BriefCommitType, number>;

/**
 * Chart-facing categories. The seven `BriefCommitType` values stay the
 * per-commit vocabulary; `docs`, `test`, and `chore` fold into `upkeep`
 * because they are neither individually meaningful to a non-technical reader
 * nor distinguishable from each other as adjacent chart segments.
 */
export const WORK_CATEGORIES = [
  'feature',
  'fix',
  'optimization',
  'refactor',
  'upkeep',
] as const;

export type WorkCategory = (typeof WORK_CATEGORIES)[number];

/** Shared so the backend's folding and the frontend's colours cannot disagree. */
export const WORK_CATEGORY_OF: Record<
  BriefCommitType,
  WorkCategory | 'unclassified'
> = {
  feature: 'feature',
  fix: 'fix',
  optimization: 'optimization',
  refactor: 'refactor',
  docs: 'upkeep',
  test: 'upkeep',
  chore: 'upkeep',
  unclassified: 'unclassified',
};

/** Executive-facing labels: [singular, plural]. */
export const WORK_CATEGORY_LABEL: Record<WorkCategory, [string, string]> = {
  feature: ['new feature', 'new features'],
  fix: ['fix', 'fixes'],
  optimization: ['speed-up', 'speed-ups'],
  refactor: ['cleanup', 'cleanups'],
  upkeep: ['upkeep item', 'upkeep (docs, tests, chores)'],
};

export type BriefDeliveryChannel = 'email' | 'slack' | 'desktop';

/** Ordered most important first — the list's order is the ranking. */
export interface BriefHighlight {
  title: string;
  detail: string;
}

export interface BriefResponse {
  id: string;
  organizationId: string;
  briefScheduleId: string | null;
  scope:
    | { type: 'project'; projectId: string | null }
    | { type: 'team'; teamId: string | null }
    | { type: 'collaborator'; collaboratorId: string | null }
    | { type: 'repository'; repositoryId: string | null; branch?: string };
  title: string;
  briefInfoTitle: string;
  summary: string;
  /** Empty for briefs generated before highlights shipped. */
  highlights: BriefHighlight[];
  periodStart: string;
  /**
   * **Exclusive** — the next local midnight, not the last instant covered. The
   * period is half-open (`start <= t < end`) so consecutive periods tile with
   * no gap even across a 25-hour DST day. To name the last day it covers,
   * format `periodEnd - 1ms`.
   */
  periodEnd: string;
  /**
   * The IANA zone `periodStart`/`periodEnd` are local midnights in, snapshotted
   * when the brief was created. Format the period with this, never the viewer's
   * zone — a schedule's own timezone is editable, and rendering an IST period
   * from Los Angeles reads a day early.
   */
  periodTimezone: string;
  contributorCount: number;
  commitCount: number;
  commitTypeCounts: BriefCommitTypeCounts;
  status: BriefStatus;
  failureReason: string | null;
  generatedAt: string | null;
  deliveredAt: string | null;
  /**
   * The channels this brief actually went out on. `status` is a whole-brief
   * verdict — one channel succeeding sets `delivered` — so anything asking
   * "was the email sent?" reads this, never the status.
   */
  deliveredChannels: BriefDeliveryChannel[];
  createdAt: string;
  updatedAt: string;
}

export interface GenerateBriefEnqueueResponse {
  briefId: string;
  jobId: string;
}

/**
 * What a scope + period holds *before* a brief is generated, so the user is not
 * spending an OpenAI call blind.
 *
 * Counted through the same predicate as the generator itself
 * (`BriefReportRepository.scopePredicate`), so `commits` here is the
 * `commitCount` the resulting brief will carry.
 */
export interface BriefPreviewResponse {
  scopeLabel: string;
  periodStart: string;
  periodEnd: string;
  commits: number;
  contributors: number;
  /** Repositories that actually contributed a commit, not the scope's size. */
  repositories: number;
  /** Commits carrying an `analyzed` analysis; a shortfall means analysis is still running. */
  analyzed: number;
  commitTypeCounts: BriefCommitTypeCounts;
  /**
   * Oldest and newest commit in the scope ignoring the period — the range a
   * custom period can usefully address. Both null when the scope has never
   * ingested a commit.
   */
  historyFrom: string | null;
  historyTo: string | null;
  /**
   * Most recent brief for this same scope within the last 24 hours, if any.
   * A hint against accidental double-spend, never a block.
   */
  recentBrief: {
    id: string;
    periodStart: string;
    periodEnd: string;
    /** See `BriefResponse.periodTimezone`. */
    periodTimezone: string;
    createdAt: string;
  } | null;
}

export interface PaginatedBriefs {
  items: BriefResponse[];
  nextCursor: string | null;
}

export interface BriefCommitResponse {
  sha: string;
  commitId: string | null;
  repositoryFullName: string | null;
  authorName: string | null;
  authorLogin: string | null;
  messageFirstLine: string | null;
  authoredAt: string | null;
  githubUrl: string | null;
  analysis: {
    commitType: string;
    summary: string;
    changes: string[];
  } | null;
}

/**
 * One filterable author of the brief's commits. `key` is the GitHub login when
 * known, else the raw commit author name — the same value `BriefCommitsQuery`'s
 * `contributor` filters on. Commits whose author is entirely unknown are omitted
 * (there is no key to filter them by).
 */
export interface BriefCommitContributor {
  key: string;
  commits: number;
}

export interface PaginatedBriefCommits {
  items: BriefCommitResponse[];
  nextCursor: string | null;
  /** Every contributor in the brief, ignoring the active filters, descending by commits. */
  contributors: BriefCommitContributor[];
}

export interface BriefReportContributor {
  /** null when the commit author is not a known GitHub collaborator. */
  collaboratorId: string | null;
  login: string | null;
  name: string;
  avatarUrl: string | null;
  isBot: boolean;
  commits: number;
  repositories: number;
}

export interface BriefReportRepositoryStat {
  repositoryId: string;
  fullName: string;
  commits: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface BriefReportDay {
  /** YYYY-MM-DD in the report's `timezone`. */
  date: string;
  counts: Record<WorkCategory | 'unclassified', number>;
  linesAdded: number;
  linesRemoved: number;
}

export interface BriefReportResponse {
  briefId: string;
  /** True when scope resolution yields nothing; every figure below is zero. */
  scopeDeleted: boolean;
  /** IANA zone from the brief's schedule; 'UTC' for ad-hoc briefs. */
  timezone: string;

  totals: {
    commits: number;
    contributors: number;
    repositoriesTouched: number;
    repositoriesInScope: number;
    linesAdded: number;
    linesRemoved: number;
    busiestDay: { date: string; commits: number } | null;
  };

  /**
   * `commits`, `linesAdded`, `linesRemoved` are ratios (0.31 = +31%);
   * `contributors` is an absolute difference. All null when there is no
   * comparable prior period.
   */
  deltas: {
    commits: number | null;
    contributors: number | null;
    linesAdded: number | null;
    linesRemoved: number | null;
  };

  /** One entry per day in [periodStart, periodEnd], zero-filled, ascending. */
  daily: BriefReportDay[];

  /** Descending by commits; zero-commit categories omitted. */
  workBreakdown: Array<{ category: WorkCategory; commits: number }>;

  /** Descending by commits. */
  contributors: BriefReportContributor[];
  repositories: BriefReportRepositoryStat[];

  /**
   * Line stats live on `github.commit_analyses`, so a commit not yet analysed
   * contributes to `commits` but not to the line figures.
   */
  locCoverage: { withLoc: number; total: number };
}
