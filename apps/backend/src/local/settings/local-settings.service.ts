import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  LocalSettingsStatus,
  LocalSettingsTestResult,
  UpdateLocalCredentialsRequest,
} from '@launchstack/api-interfaces';
import { SlackInstallationsService } from '../../integrations/slack/services/installations.service';
import { SlackMessagesService } from '../../integrations/slack/services/messages.service';
import { LocalSettingsRepository } from './local-settings.repository';
import { SecretsService, type SecretBundle } from './secrets.service';
import { smtpTransport } from './smtp';

@Injectable()
export class LocalSettingsService {
  private readonly logger = new Logger(LocalSettingsService.name);

  constructor(
    private readonly secrets: SecretsService,
    private readonly settings: LocalSettingsRepository,
    private readonly slackInstalls: SlackInstallationsService,
    private readonly slackMessages: SlackMessagesService,
  ) {}

  async status(): Promise<LocalSettingsStatus> {
    return {
      ...this.secrets.status(),
      desktopNotifications: await this.settings.desktopNotificationsEnabled(),
    };
  }

  /**
   * Credentials are proved before they are stored: SMTP with
   * `transporter.verify()` (connect + AUTH, no message sent) and Slack with
   * `auth.test`. Without that, a typo'd app password surfaces days later as a
   * failed brief instead of a red field.
   */
  async updateCredentials(
    orgId: string,
    body: UpdateLocalCredentialsRequest,
  ): Promise<LocalSettingsStatus> {
    const overlay: SecretBundle = {};
    if (body.githubToken !== undefined) overlay.GITHUB_TOKEN = body.githubToken;
    if (body.openaiApiKey !== undefined)
      overlay.OPENAI_API_KEY = body.openaiApiKey;
    if (body.smtpHost !== undefined) overlay.SMTP_HOST = body.smtpHost;
    if (body.smtpPort !== undefined) overlay.SMTP_PORT = String(body.smtpPort);
    if (body.smtpUser !== undefined) overlay.SMTP_USER = body.smtpUser;
    if (body.smtpPass !== undefined) overlay.SMTP_PASS = body.smtpPass;
    if (body.emailFrom !== undefined) overlay.EMAIL_FROM = body.emailFrom;

    const touchesSmtp = [
      body.smtpHost,
      body.smtpPort,
      body.smtpUser,
      body.smtpPass,
    ].some((v) => v !== undefined);

    if (touchesSmtp) {
      const candidate = this.secrets.smtp(overlay);
      if (candidate) {
        try {
          await smtpTransport(candidate).verify();
        } catch (err) {
          throw new BadRequestException(
            `SMTP verification failed: ${describe(err)}`,
          );
        }
      }
    }

    // Slack goes through the installation service so the encrypted row and the
    // keychain bundle are written by one path — it validates with `auth.test`
    // and throws before anything is stored.
    if (body.slackBotToken) {
      await this.slackInstalls.connectToken({
        orgId,
        token: body.slackBotToken,
        userId: null,
      });
    }

    if (Object.keys(overlay).length > 0) this.secrets.update(overlay);
    if (body.desktopNotifications !== undefined) {
      await this.settings.setDesktopNotifications(body.desktopNotifications);
    }

    return this.status();
  }

  async testEmail(to: string): Promise<LocalSettingsTestResult> {
    const smtp = this.secrets.smtp();
    if (!smtp) {
      throw new BadRequestException(
        'Email is not configured: set the SMTP host, username and password first',
      );
    }
    try {
      await smtpTransport(smtp).sendMail({
        from: smtp.from,
        to,
        subject: 'DevSummary test email',
        text: 'This is a test email from DevSummary. Your SMTP settings work.',
      });
    } catch (err) {
      throw new BadRequestException(`Test email failed: ${describe(err)}`);
    }
    this.logger.log(`Test email sent to=${to}`);
    return { ok: true, detail: `Sent to ${to}` };
  }

  async testSlackMessage(
    orgId: string,
    channelId: string,
    text?: string,
  ): Promise<LocalSettingsTestResult> {
    try {
      await this.slackMessages.postMessage(
        orgId,
        channelId,
        text ?? 'DevSummary test message — Slack delivery is working.',
      );
    } catch (err) {
      throw new BadRequestException(
        `Test message failed: ${slackHint(describe(err))}`,
      );
    }
    return { ok: true, detail: `Posted to ${channelId}` };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `not_in_channel` is the single most common Slack delivery failure and the raw
 * string tells the user nothing about the fix (R13).
 */
function slackHint(reason: string): string {
  return /not_in_channel|channel_not_found/.test(reason)
    ? `${reason} — invite the bot to the channel from inside Slack`
    : reason;
}
