import { HttpStatus } from '@nestjs/common';
import { defineError, sealRegistry } from './define-error';

export const AppError = sealRegistry({
  // --- Filter fallbacks (also usable directly) ---
  BAD_REQUEST: defineError<{ message?: string } | void>({
    status: HttpStatus.BAD_REQUEST,
    message: (args) => args?.message ?? 'Bad request',
  }),
  UNAUTHENTICATED: defineError({
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authentication required',
  }),
  FORBIDDEN: defineError<{ message?: string } | void>({
    status: HttpStatus.FORBIDDEN,
    message: (args) => args?.message ?? 'Forbidden',
  }),
  NOT_FOUND: defineError<{ message?: string } | void>({
    status: HttpStatus.NOT_FOUND,
    message: (args) => args?.message ?? 'Not found',
  }),
  INTERNAL_SERVER_ERROR: defineError({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Internal server error',
  }),

  // --- Validation ---
  VALIDATION_ERROR: defineError<{ details: unknown }>({
    status: HttpStatus.BAD_REQUEST,
    message: 'Request validation failed',
    details: ({ details }) =>
      typeof details === 'object' && details !== null
        ? (details as Record<string, unknown>)
        : { value: details },
  }),

  // --- Auth / OTP ---
  EMAIL_NOT_VERIFIED: defineError({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Verify your email before handling invites',
  }),
  EMAIL_REQUIRED: defineError({
    status: HttpStatus.BAD_REQUEST,
    message: 'Email is required',
  }),
  OTP_TYPE_INVALID: defineError<{ allowed: readonly string[] }>({
    status: HttpStatus.BAD_REQUEST,
    message: ({ allowed }) =>
      `Invalid OTP type. Must be one of: ${allowed.join(', ')}`,
    details: ({ allowed }) => ({ allowed: [...allowed] }),
  }),
  OTP_CREATE_FAILED: defineError<{ reason: string }>({
    status: HttpStatus.BAD_REQUEST,
    message: ({ reason }) => reason,
    details: ({ reason }) => ({ reason }),
  }),
  OTP_EMAIL_SEND_FAILED: defineError<{ reason: string }>({
    status: HttpStatus.BAD_GATEWAY,
    message: ({ reason }) => `Failed to send verification email: ${reason}`,
    details: ({ reason }) => ({ reason }),
  }),

  // --- Org context / guard ---
  ORG_HEADER_REQUIRED: defineError({
    status: HttpStatus.BAD_REQUEST,
    message: 'Missing or malformed X-Organization-Id header',
  }),
  ORG_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'Organization not found',
  }),
  ORG_FORBIDDEN: defineError({
    status: HttpStatus.FORBIDDEN,
    message: 'Insufficient organization role',
  }),

  // --- Org lifecycle ---
  ORG_SLUG_CONFLICT: defineError({
    status: HttpStatus.CONFLICT,
    message: 'Slug already in use',
  }),
  ORG_LAST_WORKSPACE: defineError({
    status: HttpStatus.CONFLICT,
    message:
      'This is your only workspace. Create another one before deleting it.',
  }),

  // --- Org transfer (3-way split) ---
  ORG_TRANSFER_TO_SELF: defineError({
    status: HttpStatus.CONFLICT,
    message: 'Cannot transfer to yourself',
  }),
  ORG_TRANSFER_TARGET_NOT_ADMIN: defineError({
    status: HttpStatus.CONFLICT,
    message: 'Target must be an existing admin of this organization',
  }),
  ORG_TRANSFER_CALLER_NOT_OWNER: defineError({
    status: HttpStatus.CONFLICT,
    message: 'Caller is not the current owner',
  }),

  // --- Members ---
  MEMBER_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'Member not found',
  }),
  MEMBER_IS_OWNER: defineError({
    status: HttpStatus.CONFLICT,
    message: 'Use transfer-ownership to change the owner role',
  }),
  MEMBER_REMOVE_OWNER_FORBIDDEN: defineError({
    status: HttpStatus.FORBIDDEN,
    message: 'Cannot remove the owner — use transfer-ownership or delete',
  }),
  MEMBER_REMOVE_SELF_FORBIDDEN: defineError({
    status: HttpStatus.FORBIDDEN,
    message: 'Use the leave endpoint to remove yourself',
  }),
  MEMBER_INSUFFICIENT_ROLE: defineError({
    status: HttpStatus.FORBIDDEN,
    message: 'Insufficient role',
  }),
  OWNER_CANNOT_LEAVE: defineError({
    status: HttpStatus.CONFLICT,
    message: 'Owner must transfer ownership or delete the organization',
  }),

  // --- Invites ---
  INVITE_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'Invite not found',
  }),
  INVITE_NOT_PENDING: defineError({
    status: HttpStatus.GONE,
    message: 'Invite is not pending',
  }),
  INVITE_EXPIRED: defineError({
    status: HttpStatus.GONE,
    message: 'Invite is expired',
  }),
  INVITE_TARGET_IS_MEMBER: defineError({
    status: HttpStatus.CONFLICT,
    message: 'User is already a member',
  }),
  INVITE_EMAIL_MISMATCH: defineError({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Invite was sent to a different email',
  }),
  INVITE_EMAIL_SEND_FAILED: defineError<{ reason: string }>({
    status: HttpStatus.BAD_GATEWAY,
    message: ({ reason }) => `Failed to send invite email: ${reason}`,
    details: ({ reason }) => ({ reason }),
  }),

  // --- GitHub integration ---
  // 409, not 500: "you have not connected GitHub yet" is a state the caller
  // can fix, not a server fault. The code name is kept — it is matched by the
  // frontend and by the credential layer.
  GITHUB_APP_NOT_CONFIGURED: defineError({
    status: HttpStatus.CONFLICT,
    message:
      'No GitHub token is connected. Add a fine-grained personal access token in Settings to connect GitHub.',
  }),
  GITHUB_STATE_INVALID: defineError({
    status: HttpStatus.BAD_REQUEST,
    message: 'GitHub install state is invalid or expired',
  }),
  GITHUB_STATE_USER_MISMATCH: defineError({
    status: HttpStatus.FORBIDDEN,
    message: 'GitHub install state belongs to a different user',
  }),
  GITHUB_INSTALLATION_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'GitHub installation not found',
  }),
  // Deliberately does not name the other organization — it may belong to a
  // different tenant the caller has no business knowing about. It does say the
  // App is still installed, because we deliberately do not uninstall it here:
  // GitHub allows one installation per account, so uninstalling would break
  // ingestion for the org that legitimately owns it.
  GITHUB_INSTALLATION_ALREADY_CONNECTED: defineError({
    status: HttpStatus.CONFLICT,
    message:
      'This GitHub account is already connected to another organization; disconnect it there before connecting it here. The GitHub App remains installed on the account.',
  }),
  GITHUB_API_FAILED: defineError<{ reason: string }>({
    status: HttpStatus.BAD_GATEWAY,
    message: ({ reason }) => `GitHub API call failed: ${reason}`,
    details: ({ reason }) => ({ reason }),
  }),
  GITHUB_WEBHOOK_SIGNATURE_MISSING: defineError({
    status: HttpStatus.BAD_REQUEST,
    message: 'Missing X-Hub-Signature-256 header',
  }),
  GITHUB_WEBHOOK_SIGNATURE_INVALID: defineError({
    status: HttpStatus.UNAUTHORIZED,
    message: 'Invalid GitHub webhook signature',
  }),

  // --- Commit analysis ---
  GITHUB_REPOSITORY_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'GitHub repository not found',
  }),
  GITHUB_REPOSITORY_BRANCH_NOT_CONFIGURED: defineError({
    status: HttpStatus.CONFLICT,
    message:
      'No branch selected for this repository. Choose the branches to read commits from before ingesting.',
  }),
  GITHUB_REPOSITORY_BRANCHES_LOCKED: defineError<{
    fullName: string;
    branches: string[];
  }>({
    status: HttpStatus.CONFLICT,
    message: ({ fullName, branches }) =>
      `${fullName} already reads ${branches.join(', ')}. Branch selection can't be changed yet.`,
    details: ({ fullName, branches }) => ({ fullName, branches }),
  }),
  GITHUB_REPOSITORY_BRANCH_NOT_TRACKED: defineError<{ branch: string }>({
    status: HttpStatus.CONFLICT,
    message: ({ branch }) =>
      `Branch ${branch} is not tracked for this repository`,
    details: ({ branch }) => ({ branch }),
  }),
  COMMIT_ANALYSIS_INVALID_WINDOW: defineError<{ reason: string }>({
    status: HttpStatus.BAD_REQUEST,
    message: ({ reason }) => reason,
    details: ({ reason }) => ({ reason }),
  }),
  OPENAI_NOT_CONFIGURED: defineError({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'OpenAI is not configured on this server. Set OPENAI_API_KEY.',
  }),
  OPENAI_API_FAILED: defineError<{ reason: string }>({
    status: HttpStatus.BAD_GATEWAY,
    message: ({ reason }) => `OpenAI request failed: ${reason}`,
    details: ({ reason }) => ({ reason }),
  }),
  OPENAI_RESPONSE_INVALID: defineError<{ reason: string }>({
    status: HttpStatus.BAD_GATEWAY,
    message: ({ reason }) => `OpenAI response was not valid: ${reason}`,
    details: ({ reason }) => ({ reason }),
  }),

  // --- Slack integration ---
  SLACK_NOT_CONFIGURED: defineError({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message:
      'Slack is not configured on this server. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REDIRECT_URI.',
  }),
  SLACK_INSTALLATION_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'Slack installation not found',
  }),
  SLACK_API_FAILED: defineError<{ reason: string }>({
    status: HttpStatus.BAD_GATEWAY,
    message: ({ reason }) => `Slack API call failed: ${reason}`,
    details: ({ reason }) => ({ reason }),
  }),

  // --- Briefs: projects ---
  PROJECT_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'Project not found',
  }),
  PROJECT_NAME_CONFLICT: defineError({
    status: HttpStatus.CONFLICT,
    message: 'A project with this name already exists in this organization',
  }),

  // --- Briefs: teams ---
  TEAM_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'Team not found',
  }),
  TEAM_NAME_CONFLICT: defineError({
    status: HttpStatus.CONFLICT,
    message: 'A team with this name already exists in this organization',
  }),

  // --- Briefs: collaborators (general) ---
  GITHUB_COLLABORATOR_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'GitHub collaborator not found in this organization',
  }),

  // --- Briefs: schedules ---
  BRIEF_SCHEDULE_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'Brief schedule not found',
  }),
  BRIEF_SCHEDULE_INVALID_SCOPE: defineError<{ reason: string }>({
    status: HttpStatus.BAD_REQUEST,
    message: ({ reason }) => `Invalid brief schedule scope: ${reason}`,
    details: ({ reason }) => ({ reason }),
  }),
  BRIEF_SCHEDULE_INVALID_TIMEZONE: defineError<{ timezone: string }>({
    status: HttpStatus.BAD_REQUEST,
    message: ({ timezone }) => `Invalid IANA timezone: ${timezone}`,
    details: ({ timezone }) => ({ timezone }),
  }),
  BRIEF_SCHEDULE_INVALID_CADENCE: defineError<{ reason: string }>({
    status: HttpStatus.BAD_REQUEST,
    message: ({ reason }) => `Invalid cadence: ${reason}`,
    details: ({ reason }) => ({ reason }),
  }),
  // Each schedule creation backfills up to BRIEFS_BACKFILL_MAX_BRIEFS briefs,
  // one OpenAI call apiece, so an uncapped count is a cost amplifier.
  BRIEF_SCHEDULE_LIMIT_REACHED: defineError<{ limit: number }>({
    status: HttpStatus.CONFLICT,
    message: ({ limit }) =>
      `This organization already has the maximum of ${limit} brief schedules`,
    details: ({ limit }) => ({ limit }),
  }),

  // --- Briefs: briefs ---
  BRIEF_NOT_FOUND: defineError({
    status: HttpStatus.NOT_FOUND,
    message: 'Brief not found',
  }),
  BRIEF_NOT_DELETABLE: defineError({
    status: HttpStatus.CONFLICT,
    message:
      "This brief belongs to a schedule and can't be deleted on its own — delete or pause the schedule instead",
  }),
  BRIEF_INVALID_PERIOD: defineError<{ reason: string }>({
    status: HttpStatus.BAD_REQUEST,
    message: ({ reason }) => `Invalid period: ${reason}`,
    details: ({ reason }) => ({ reason }),
  }),
  BRIEF_NOT_DELIVERABLE: defineError({
    status: HttpStatus.CONFLICT,
    message:
      "This brief hasn't been generated yet, so there is nothing to send",
  }),
  BRIEF_DELIVERY_CHANNEL_NOT_CONFIGURED: defineError<{ channel: string }>({
    status: HttpStatus.BAD_REQUEST,
    message: ({ channel }) =>
      `No ${channel} recipient is configured for this brief`,
    details: ({ channel }) => ({ channel }),
  }),
  // Surfaced synchronously to a human pressing a button, so the upstream
  // reason (`not_in_channel`, a rejected recipient) is the whole value.
  BRIEF_DELIVERY_FAILED: defineError<{ channel: string; reason: string }>({
    status: HttpStatus.BAD_GATEWAY,
    message: ({ channel, reason }) => `${channel} delivery failed: ${reason}`,
    details: ({ channel, reason }) => ({ channel, reason }),
  }),
  SLACK_CHANNEL_REQUIRED: defineError({
    status: HttpStatus.BAD_REQUEST,
    message: 'A Slack channel id is required when Slack delivery is configured',
  }),

  // --- Analytics ---
  ANALYTICS_RANGE_TOO_LARGE: defineError({
    status: HttpStatus.BAD_REQUEST,
    message:
      'Requested range resolves to too many buckets; narrow the range or use week granularity',
  }),
  ANALYTICS_TIMEZONE_UNSUPPORTED: defineError<{ timezone: string }>({
    status: HttpStatus.BAD_REQUEST,
    message: ({ timezone }) =>
      `Timezone is not supported for bucketing: ${timezone}`,
    details: ({ timezone }) => ({ timezone }),
  }),

  // --- Waitlist ---
  WAITLIST_RATE_LIMITED: defineError<{ retryAfterSeconds: number }>({
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: ({ retryAfterSeconds }) =>
      `Too many signup attempts; try again in ${retryAfterSeconds}s`,
    details: ({ retryAfterSeconds }) => ({ retryAfterSeconds }),
  }),
});

export type AppErrorCode = keyof typeof AppError;
