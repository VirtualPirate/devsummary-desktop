/**
 * Every field is optional and write-only: an omitted key is left alone, an
 * empty string clears the credential. Nothing is ever read back.
 *
 * GitHub is deliberately absent: its PAT goes to
 * `POST /api/integrations/github/token`, which validates it and writes the
 * encrypted installation row ingest reads from.
 */
export interface UpdateLocalCredentialsRequest {
  openaiApiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  emailFrom?: string;
  slackBotToken?: string;
  desktopNotifications?: boolean;
  /** Empty string clears the override and restores the built-in default. */
  commitAnalysisModel?: string;
  briefModel?: string;
}

export interface TestEmailRequest {
  to: string;
}
