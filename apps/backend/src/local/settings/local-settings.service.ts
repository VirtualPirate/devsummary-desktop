import { resolve } from 'node:path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  LocalSettingsStatus,
  LocalSettingsTestResult,
  LocalSettingsUsage,
  UpdateLocalCredentialsRequest,
} from '@launchstack/api-interfaces';
import { DEFAULT_BRIEF_MODEL } from '../../briefs/briefs-config';
import { resolveDataDir } from '../../databases/kysely/kysely.module';
import { DEFAULT_COMMIT_ANALYSIS_MODEL } from '../../integrations/github/commit-analysis/commit-analysis.config';
import { SlackInstallationsService } from '../../integrations/slack/services/installations.service';
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
  ) {}

  async status(): Promise<LocalSettingsStatus> {
    return {
      ...this.secrets.status(),
      desktopNotifications: await this.settings.desktopNotificationsEnabled(),
      // Absolute, because the headless fallback is the relative `./.data` and a
      // path the user cannot paste into Finder is not an answer.
      dataDir: resolve(resolveDataDir()),
      commitAnalysisModel:
        this.secrets.get('OPENAI_COMMIT_ANALYSIS_MODEL') ??
        DEFAULT_COMMIT_ANALYSIS_MODEL,
      briefModel: this.secrets.get('OPENAI_BRIEF_MODEL') ?? DEFAULT_BRIEF_MODEL,
    };
  }

  usage(organizationId: string): Promise<LocalSettingsUsage> {
    return this.settings.tokenTotals(organizationId);
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
    if (body.commitAnalysisModel !== undefined)
      overlay.OPENAI_COMMIT_ANALYSIS_MODEL = body.commitAnalysisModel;
    if (body.briefModel !== undefined)
      overlay.OPENAI_BRIEF_MODEL = body.briefModel;

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
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
