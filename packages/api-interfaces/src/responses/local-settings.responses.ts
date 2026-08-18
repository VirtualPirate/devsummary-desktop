/**
 * Which local credentials are configured. Credentials are booleans only — a
 * pasted secret is never echoed back to the renderer after it is saved. The
 * model names and the data directory are not secrets, so they come back whole:
 * the settings screen has to show what is actually in effect.
 */
export interface LocalSettingsStatus {
  github: boolean;
  openai: boolean;
  smtp: boolean;
  slack: boolean;
  emailFrom: boolean;
  desktopNotifications: boolean;
  /** Absolute path of the folder holding the database, logs and secrets. */
  dataDir: string;
  /** Effective model — the override when set, otherwise the built-in default. */
  commitAnalysisModel: string;
  briefModel: string;
}

/**
 * Running OpenAI spend, from the token counts already stored on every commit
 * analysis and every brief. Workspace-scoped, like everything else the settings
 * screen reads through `X-Organization-Id`.
 */
export interface LocalSettingsUsage {
  analysisPromptTokens: number;
  analysisCompletionTokens: number;
  briefPromptTokens: number;
  briefCompletionTokens: number;
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
