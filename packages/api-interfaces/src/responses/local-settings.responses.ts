/** The AI providers a local install can be pointed at. */
export type LlmProviderName =
  | "openai"
  | "gemini"
  | "claude-code"
  | "opencode"
  | "cursor"
  | "codex";

/**
 * The AI providers that are a coding-agent CLI on the user's machine rather
 * than an API key. Every value is also an `LlmProviderName`.
 */
export type AgentCliProviderName =
  | "claude-code"
  | "opencode"
  | "cursor"
  | "codex";

/**
 * Whether one agent CLI can actually run here. Served by
 * `GET /api/local-settings/agents`, which is slow-ish to compute (it may spawn
 * a login shell) and machine-wide, which is why it is not folded into
 * `LocalSettingsStatus`.
 */
export interface AgentCliStatus {
  id: AgentCliProviderName;
  displayName: string;
  /** Located **and** proved runnable by executing its version flag. */
  installed: boolean;
  path: string | null;
  version: string | null;
  /** `null` when the CLI has no separate login state to probe. */
  authenticated: boolean | null;
  installHint: string;
}

/**
 * Which local credentials are configured. Credentials are booleans only — a
 * pasted secret is never echoed back to the renderer after it is saved. The
 * model names and the data directory are not secrets, so they come back whole:
 * the settings screen has to show what is actually in effect.
 */
export interface LocalSettingsStatus {
  github: boolean;
  /** A key is stored for this provider. Both are reported; one is selected. */
  openai: boolean;
  gemini: boolean;
  /** Which provider answers AI calls. The keys are independent of it. */
  llmProvider: LlmProviderName;
  smtp: boolean;
  slack: boolean;
  emailFrom: boolean;
  desktopNotifications: boolean;
  /** Absolute path of the folder holding the database, logs and secrets. */
  dataDir: string;
  /**
   * Effective model for the **selected** provider — the override when set,
   * otherwise that provider's built-in default.
   */
  commitAnalysisModel: string;
  briefModel: string;
}

/** Bot scopes the Slack app must be granted, shown next to the token field. */
export const SLACK_BOT_SCOPES = [
  "chat:write",
  "channels:read",
  "groups:read",
  "users:read",
] as const;

export interface LocalSettingsTestResult {
  ok: true;
  detail: string;
}
