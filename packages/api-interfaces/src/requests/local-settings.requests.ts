import type { LlmProviderName } from "../responses/local-settings.responses";

/**
 * Every field is optional and write-only: an omitted key is left alone, an
 * empty string clears the credential. Nothing is ever read back.
 *
 * GitHub is deliberately absent: its PAT goes to
 * `POST /api/integrations/github/token`, which validates it and writes the
 * encrypted installation row ingest reads from.
 */
export interface UpdateLocalCredentialsRequest {
  /**
   * Switches which provider answers AI calls; the stored keys are untouched.
   * A CLI provider (`claude-code`) is rejected with 400 when the binary is not
   * installed — nothing is stored in that case.
   */
  llmProvider?: LlmProviderName;
  openaiApiKey?: string;
  geminiApiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  emailFrom?: string;
  slackBotToken?: string;
  desktopNotifications?: boolean;
  /**
   * Written for the provider this request selects (`llmProvider` when present,
   * otherwise the one already in effect). Empty string clears that override and
   * restores the provider's built-in default.
   */
  commitAnalysisModel?: string;
  briefModel?: string;
}

export interface TestEmailRequest {
  to: string;
}
