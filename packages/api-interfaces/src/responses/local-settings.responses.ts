/**
 * Which local credentials are configured. Booleans only — a pasted secret is
 * never echoed back to the renderer after it is saved.
 */
export interface LocalSettingsStatus {
  github: boolean;
  openai: boolean;
  smtp: boolean;
  slack: boolean;
  emailFrom: boolean;
  desktopNotifications: boolean;
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
