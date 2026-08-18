import type {
  ColumnType,
  Generated,
  Insertable,
  Selectable,
  Updateable,
} from 'kysely';

/**
 * Column helpers.
 *
 * The Kysely instance runs with CamelCasePlugin, so all table/column
 * identifiers here are camelCase and are translated to snake_case SQL.
 *
 * - Timestamps come back as Date (node-postgres parses them).
 * - int8 (bigint) columns come back as JS BigInt via the pg type parser
 *   registered in kysely.module.ts. Aggregates like count() therefore also
 *   return BigInt — convert with Number() at call sites.
 * - jsonb columns are declared with Json<T>: reads are parsed values, writes
 *   must be JSON.stringify'd strings (node-postgres would otherwise serialize
 *   JS arrays as Postgres arrays, corrupting jsonb array values).
 */
export type Json<T> = ColumnType<T, string, string>;
export type GeneratedTimestamp = ColumnType<
  Date,
  Date | string | undefined,
  Date | string
>;
export type Int8 = ColumnType<
  bigint,
  bigint | number | string,
  bigint | number | string
>;
export type NullableInt8 = ColumnType<
  bigint | null,
  bigint | number | string | null,
  bigint | number | string | null
>;

// ---------------------------------------------------------------------------
// Enums (Postgres enum types)
// ---------------------------------------------------------------------------

export type OrganizationRole = 'owner' | 'admin' | 'viewer';
export type InviteRole = 'admin' | 'viewer';
export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type GithubAccountType = 'User' | 'Organization';
export type GithubCommitType =
  'fix' | 'feature' | 'optimization' | 'refactor' | 'docs' | 'test' | 'chore';
export type GithubCommitAnalysisStatus =
  'analyzed' | 'skipped_merge' | 'skipped_empty' | 'failed';
export type BriefCadenceType = 'daily' | 'weekly' | 'monthly';
export type BriefScopeType = 'project' | 'team' | 'collaborator' | 'repository';
export type BriefStatus =
  'pending' | 'generating' | 'generated' | 'delivered' | 'failed';
/**
 * Which of git's two dates a brief's commits were selected by. See
 * `BriefsTable.commitClock` and `commit-clock.ts`.
 */
export type BriefCommitClock = 'authored' | 'committed';
/** Mirrors `BriefDeliveryChannel` in @launchstack/api-interfaces. */
export type BriefDeliveryChannel = 'email' | 'slack' | 'desktop';
/**
 * Structurally identical to `BriefHighlight` in @launchstack/api-interfaces,
 * redeclared here because this file imports only from `kysely`.
 */
export interface BriefHighlightRow {
  title: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// public schema
// ---------------------------------------------------------------------------

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
}

export interface OrganizationMembersTable {
  id: Generated<string>;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: GeneratedTimestamp;
}

export interface OrganizationInvitesTable {
  id: Generated<string>;
  organizationId: string;
  email: string;
  role: InviteRole;
  tokenHash: string;
  status: Generated<InviteStatus>;
  expiresAt: Date;
  invitedByUserId: string | null;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
}

// ---------------------------------------------------------------------------
// auth schema (Better Auth)
// ---------------------------------------------------------------------------

export interface AuthUserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: Generated<boolean>;
  image: string | null;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
}

export interface AuthSessionTable {
  id: string;
  expiresAt: Date;
  token: string;
  createdAt: GeneratedTimestamp;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
}

export interface AuthAccountTable {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  password: string | null;
  createdAt: GeneratedTimestamp;
  updatedAt: Date;
}

export interface AuthVerificationTable {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
}

// ---------------------------------------------------------------------------
// github schema
// ---------------------------------------------------------------------------

export interface GithubInstallationsTable {
  id: Generated<string>;
  organizationId: string;
  githubInstallationId: Int8;
  githubAccountId: Int8;
  githubAccountLogin: string;
  githubAccountType: GithubAccountType;
  githubAccountAvatarUrl: string | null;
  targetType: string;
  suspendedAt: Date | null;
  connectedByUserId: string | null;
  raw: Json<unknown> | null;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

export interface GithubRepositoriesTable {
  id: Generated<string>;
  installationId: string;
  githubRepoId: Int8;
  name: string;
  fullName: string;
  private: boolean;
  raw: Json<unknown> | null;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

/**
 * Branches a repository is tracked on. No live row = the repository is inert:
 * nothing is fetched, analyzed, or reported for it.
 */
export interface GithubRepositoryBranchesTable {
  id: Generated<string>;
  repositoryId: string;
  branch: string;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

/**
 * Which branches a commit was seen on — many rows per commit, since branches
 * share ancestry. Survives the branch being untracked, so `branch` is text
 * rather than a reference into `repositoryBranches`.
 */
export interface GithubCommitBranchesTable {
  id: Generated<string>;
  commitId: string;
  branch: string;
  createdAt: GeneratedTimestamp;
}

export interface GithubCommitsTable {
  id: Generated<string>;
  repositoryId: string;
  sha: string;
  parentCount: number;
  message: string;
  authorGithubUserId: NullableInt8;
  authorGithubLogin: string | null;
  authorName: string;
  authorEmail: string;
  committerGithubUserId: NullableInt8;
  committerGithubLogin: string | null;
  committerName: string;
  committerEmail: string;
  authoredAt: Date;
  committedAt: Date;
  raw: Json<unknown>;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

export interface GithubCommitAnalysesTable {
  id: Generated<string>;
  commitId: string;
  commitType: GithubCommitType | null;
  summary: string | null;
  changes: Json<string[]> | null;
  status: GithubCommitAnalysisStatus;
  failureReason: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  diffCharsSent: number | null;
  diffWasTruncated: Generated<boolean>;
  additions: number | null;
  deletions: number | null;
  analyzedAt: GeneratedTimestamp;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

export interface GithubWebhookEventsTable {
  id: string;
  event: string | null;
  raw: Json<unknown>;
  state: Generated<string>;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

export interface GithubCollaboratorsTable {
  id: Generated<string>;
  githubUserId: Int8;
  login: string;
  nodeId: string | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
  type: string | null;
  siteAdmin: Generated<boolean>;
  raw: Json<unknown>;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

export interface GithubRepositoryCollaboratorsTable {
  id: Generated<string>;
  repositoryId: string;
  collaboratorId: string;
  roleName: string;
  permissionAdmin: boolean;
  permissionMaintain: boolean;
  permissionPush: boolean;
  permissionTriage: boolean;
  permissionPull: boolean;
  raw: Json<unknown>;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

// ---------------------------------------------------------------------------
// slack schema
// ---------------------------------------------------------------------------

export interface SlackInstallationRaw {
  teamId: string;
  teamName: string;
  botUserId: string;
  appId: string;
  scope: string;
  authedUserId?: string;
  connectedByUserId?: string;
  oauthResponse: unknown;
}

export interface SlackInstallationsTable {
  id: Generated<string>;
  organizationId: string;
  accessToken: string;
  /** Slack workspace id; null only for rows predating the team_id backfill. */
  teamId: string | null;
  raw: Json<SlackInstallationRaw>;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

// ---------------------------------------------------------------------------
// briefs schema
// ---------------------------------------------------------------------------

export interface ProjectsTable {
  id: Generated<string>;
  organizationId: string;
  name: string;
  description: string | null;
  color: string | null;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

export interface ProjectRepositoriesTable {
  id: Generated<string>;
  projectId: string;
  repositoryId: string;
  createdAt: GeneratedTimestamp;
}

export interface TeamsTable {
  id: Generated<string>;
  organizationId: string;
  name: string;
  description: string | null;
  color: string | null;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

export interface TeamCollaboratorsTable {
  id: Generated<string>;
  teamId: string;
  collaboratorId: string;
  createdAt: GeneratedTimestamp;
}

export interface BriefSchedulesTable {
  id: Generated<string>;
  organizationId: string;
  name: string;
  cadenceType: BriefCadenceType;
  cadenceTime: string;
  cadenceDayOfWeek: number | null;
  cadenceDayOfMonth: number | null;
  timezone: Generated<string>;
  scopeType: BriefScopeType;
  scopeProjectId: string | null;
  scopeTeamId: string | null;
  scopeCollaboratorId: string | null;
  scopeRepositoryId: string | null;
  /** Narrows a `repository` scope to one branch. NULL = every tracked branch. */
  scopeBranch: string | null;
  paused: Generated<boolean>;
  nextRunAt: Date;
  lastSentAt: Date | null;
  emailRecipients: Generated<string[]>;
  slackInstallationId: string | null;
  slackChannelId: string | null;
  createdByMemberId: string | null;
  dispatchFailureCount: Generated<number>;
  dispatchFailureReason: string | null;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

export interface BriefsTable {
  id: Generated<string>;
  organizationId: string;
  briefScheduleId: string | null;
  scopeType: BriefScopeType;
  scopeProjectId: string | null;
  scopeTeamId: string | null;
  scopeCollaboratorId: string | null;
  scopeRepositoryId: string | null;
  /** Narrows a `repository` scope to one branch. NULL = every tracked branch. */
  scopeBranch: string | null;
  title: Generated<string>;
  briefInfoTitle: Generated<string>;
  summary: Generated<string>;
  // Not `Generated<Json<…>>`: Kysely's `Generated<S>` is `ColumnType<S, S |
  // undefined, S>` — it does not unwrap a nested ColumnType, so it would ask
  // for the parsed array on write. Spelled out so writes stay stringified and
  // the column's `'[]'::jsonb` default keeps it optional on insert.
  highlights: ColumnType<BriefHighlightRow[], string | undefined, string>;
  periodStart: Date;
  periodEnd: Date;
  /**
   * The timezone `periodStart`/`periodEnd` were computed in, frozen at creation.
   * Read it — never the schedule's current `timezone`, which is editable and
   * would re-tile every historical report. Defaults to `'UTC'`.
   */
  periodTimezone: Generated<string>;
  /**
   * Which commit timestamp this brief's period was selected on, frozen at
   * creation. New briefs are `'committed'` — a brief covers what *landed* on the
   * tracked branch, the same clock ingestion resumes from. Rows predating the
   * switch stay `'authored'` (the column default), which is exactly the
   * semantics they were generated under, so their reports keep matching their
   * own stored `commitCount`. Read it — never assume a clock.
   */
  commitClock: Generated<BriefCommitClock>;
  contributorCount: Generated<number>;
  commitCount: Generated<number>;
  status: Generated<BriefStatus>;
  failureReason: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  deliveryEmails: Generated<string[]>;
  deliverySlackChannelId: string | null;
  generatedAt: Date | null;
  deliveredAt: Date | null;
  /** Channels actually sent, appended per success. See `BriefResponse`. */
  deliveredChannels: Generated<BriefDeliveryChannel[]>;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  deletedAt: Date | null;
}

export interface BriefCommitsTable {
  id: Generated<string>;
  briefId: string;
  commitId: string | null;
  sha: string;
  createdAt: GeneratedTimestamp;
}

// ---------------------------------------------------------------------------
// marketing schema
// ---------------------------------------------------------------------------

/** Pre-launch signups from the marketing site. Write-once rows. */
export interface MarketingWaitlistTable {
  id: Generated<string>;
  email: string;
  createdAt: GeneratedTimestamp;
}

// ---------------------------------------------------------------------------
// public schema — local job queue (replaces Temporal, see migration 00015)
// ---------------------------------------------------------------------------

/**
 * One row per unit of background work. `id` is the dedup key: enqueueing with a
 * stable id and `on conflict do nothing` is what Temporal's `USE_EXISTING`
 * policy used to do.
 *
 * There is no `done` state: a handler that returns deletes its own row, so the
 * table only ever holds work that is outstanding or dead.
 */
export type JobState = 'pending' | 'running' | 'failed';

export interface JobsTable {
  id: string;
  type: string;
  args: Json<Record<string, unknown>>;
  /** `fetching` | `analyzing` | `generating` — the old search attribute. */
  phase: string | null;
  organizationId: string | null;
  state: Generated<JobState>;
  /** Incremented at claim time, so a job that crashes the process still exhausts its attempts. */
  attempts: Generated<number>;
  maxAttempts: Generated<number>;
  runAt: GeneratedTimestamp;
  createdAt: GeneratedTimestamp;
  error: string | null;
}

/** Machine-local key/value state with no organization (e.g. `last_sweep_at`). */
export interface LocalSettingsTable {
  key: string;
  value: Json<unknown>;
}

// ---------------------------------------------------------------------------
// Database interface — keys are camelCase; CamelCasePlugin maps them to the
// snake_case (and schema-qualified) SQL identifiers.
// ---------------------------------------------------------------------------

export interface Database {
  organizations: OrganizationsTable;
  organizationMembers: OrganizationMembersTable;
  organizationInvites: OrganizationInvitesTable;
  jobs: JobsTable;
  localSettings: LocalSettingsTable;

  'auth.user': AuthUserTable;
  'auth.session': AuthSessionTable;
  'auth.account': AuthAccountTable;
  'auth.verification': AuthVerificationTable;

  'github.installations': GithubInstallationsTable;
  'github.repositories': GithubRepositoriesTable;
  'github.repositoryBranches': GithubRepositoryBranchesTable;
  'github.commits': GithubCommitsTable;
  'github.commitAnalyses': GithubCommitAnalysesTable;
  'github.commitBranches': GithubCommitBranchesTable;
  'github.webhookEvents': GithubWebhookEventsTable;
  'github.collaborators': GithubCollaboratorsTable;
  'github.repositoryCollaborators': GithubRepositoryCollaboratorsTable;

  'slack.installations': SlackInstallationsTable;

  'briefs.projects': ProjectsTable;
  'briefs.projectRepositories': ProjectRepositoriesTable;
  'briefs.teams': TeamsTable;
  'briefs.teamCollaborators': TeamCollaboratorsTable;
  'briefs.briefSchedules': BriefSchedulesTable;
  'briefs.briefs': BriefsTable;
  'briefs.briefCommits': BriefCommitsTable;

  'marketing.waitlist': MarketingWaitlistTable;
}

// ---------------------------------------------------------------------------
// Row type aliases
// ---------------------------------------------------------------------------

export type UserSelect = Selectable<AuthUserTable>;
export type UserInsert = Insertable<AuthUserTable>;

export type SessionSelect = Selectable<AuthSessionTable>;
export type SessionInsert = Insertable<AuthSessionTable>;

export type AccountSelect = Selectable<AuthAccountTable>;
export type AccountInsert = Insertable<AuthAccountTable>;

export type VerificationSelect = Selectable<AuthVerificationTable>;
export type VerificationInsert = Insertable<AuthVerificationTable>;

export type OrganizationSelect = Selectable<OrganizationsTable>;
export type OrganizationInsert = Insertable<OrganizationsTable>;
export type OrganizationUpdate = Updateable<OrganizationsTable>;

export type OrganizationMemberSelect = Selectable<OrganizationMembersTable>;
export type OrganizationMemberInsert = Insertable<OrganizationMembersTable>;

export type OrganizationInviteSelect = Selectable<OrganizationInvitesTable>;
export type OrganizationInviteInsert = Insertable<OrganizationInvitesTable>;
export type OrganizationInviteUpdate = Updateable<OrganizationInvitesTable>;

export type GithubInstallationSelect = Selectable<GithubInstallationsTable>;
export type GithubInstallationInsert = Insertable<GithubInstallationsTable>;
export type GithubInstallationUpdate = Updateable<GithubInstallationsTable>;

export type GithubRepositorySelect = Selectable<GithubRepositoriesTable>;
export type GithubRepositoryInsert = Insertable<GithubRepositoriesTable>;
export type GithubRepositoryUpdate = Updateable<GithubRepositoriesTable>;

export type GithubRepositoryBranchSelect =
  Selectable<GithubRepositoryBranchesTable>;
export type GithubRepositoryBranchInsert =
  Insertable<GithubRepositoryBranchesTable>;

export type GithubCommitBranchSelect = Selectable<GithubCommitBranchesTable>;
export type GithubCommitBranchInsert = Insertable<GithubCommitBranchesTable>;

export type GithubWebhookEventSelect = Selectable<GithubWebhookEventsTable>;
export type GithubWebhookEventInsert = Insertable<GithubWebhookEventsTable>;

export type GithubCommitSelect = Selectable<GithubCommitsTable>;
export type GithubCommitInsert = Insertable<GithubCommitsTable>;

export type GithubCommitAnalysisSelect = Selectable<GithubCommitAnalysesTable>;
export type GithubCommitAnalysisInsert = Insertable<GithubCommitAnalysesTable>;
export type GithubCommitAnalysisUpdate = Updateable<GithubCommitAnalysesTable>;

export type GithubCollaboratorSelect = Selectable<GithubCollaboratorsTable>;
export type GithubCollaboratorInsert = Insertable<GithubCollaboratorsTable>;

export type GithubRepositoryCollaboratorSelect =
  Selectable<GithubRepositoryCollaboratorsTable>;
export type GithubRepositoryCollaboratorInsert =
  Insertable<GithubRepositoryCollaboratorsTable>;

export type SlackInstallationSelect = Selectable<SlackInstallationsTable>;
export type SlackInstallationInsert = Insertable<SlackInstallationsTable>;

export type ProjectSelect = Selectable<ProjectsTable>;
export type ProjectInsert = Insertable<ProjectsTable>;
export type ProjectUpdate = Updateable<ProjectsTable>;

export type ProjectRepositorySelect = Selectable<ProjectRepositoriesTable>;
export type ProjectRepositoryInsert = Insertable<ProjectRepositoriesTable>;

export type TeamSelect = Selectable<TeamsTable>;
export type TeamInsert = Insertable<TeamsTable>;
export type TeamUpdate = Updateable<TeamsTable>;

export type TeamCollaboratorSelect = Selectable<TeamCollaboratorsTable>;
export type TeamCollaboratorInsert = Insertable<TeamCollaboratorsTable>;

export type BriefScheduleSelect = Selectable<BriefSchedulesTable>;
export type BriefScheduleInsert = Insertable<BriefSchedulesTable>;
export type BriefScheduleUpdate = Updateable<BriefSchedulesTable>;

export type BriefSelect = Selectable<BriefsTable>;
export type BriefInsert = Insertable<BriefsTable>;
export type BriefUpdate = Updateable<BriefsTable>;

export type BriefCommitSelect = Selectable<BriefCommitsTable>;
export type BriefCommitInsert = Insertable<BriefCommitsTable>;

export type WaitlistEntrySelect = Selectable<MarketingWaitlistTable>;
export type WaitlistEntryInsert = Insertable<MarketingWaitlistTable>;

export type JobSelect = Selectable<JobsTable>;
export type JobInsert = Insertable<JobsTable>;
export type JobUpdate = Updateable<JobsTable>;

export type LocalSettingSelect = Selectable<LocalSettingsTable>;
export type LocalSettingInsert = Insertable<LocalSettingsTable>;
