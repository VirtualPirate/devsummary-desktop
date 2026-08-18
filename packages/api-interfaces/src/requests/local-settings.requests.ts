/**
 * Every field is optional and write-only: an omitted key is left alone, an
 * empty string clears the credential. Nothing is ever read back.
 */
export interface UpdateLocalCredentialsRequest {
  githubToken?: string;
  openaiApiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  emailFrom?: string;
  slackBotToken?: string;
  desktopNotifications?: boolean;
}

export interface TestEmailRequest {
  to: string;
}

export interface TestSlackMessageRequest {
  channelId: string;
  text?: string;
}
