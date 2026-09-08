import { resolve } from 'node:path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  LlmProviderName,
  LocalSettingsStatus,
  LocalSettingsTestResult,
  LocalSettingsUsage,
  UpdateLocalCredentialsRequest,
} from '@launchstack/api-interfaces';
import { BRIEF_MODEL_VARS } from '../../briefs/briefs-config';
import { DEFAULT_MODELS, LLM_PROVIDERS } from '../../common/llm';
import { resolveDataDir } from '../../databases/kysely/kysely.module';
import { COMMIT_ANALYSIS_MODEL_VARS } from '../../integrations/github/commit-analysis/commit-analysis.config';
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

  /**
   * Unlike `resolveLlmProvider`, an unrecognised value falls back instead of
   * throwing: the AI page is where an operator would fix a hand-edited bundle,
   * so it is the one screen that must still render. Nothing in the app can
   * write a bad value — the DTO is a zod enum.
   */
  private provider(): LlmProviderName {
    const stored = this.secrets.get('LLM_PROVIDER');
    return LLM_PROVIDERS.find((p) => p === stored) ?? 'openai';
  }

  async status(): Promise<LocalSettingsStatus> {
    const llmProvider = this.provider();
    return {
      ...this.secrets.status(),
      llmProvider,
      desktopNotifications: await this.settings.desktopNotificationsEnabled(),
      // Absolute, because the headless fallback is the relative `./.data` and a
      // path the user cannot paste into Finder is not an answer.
      dataDir: resolve(resolveDataDir()),
      // The effective model for the *selected* provider: an OpenAI override is
      // still stored while Gemini is selected, and reporting it would put a
      // model the run will never use in front of the user.
      commitAnalysisModel:
        this.secrets.get(COMMIT_ANALYSIS_MODEL_VARS[llmProvider]) ??
        DEFAULT_MODELS[llmProvider],
      briefModel:
        this.secrets.get(BRIEF_MODEL_VARS[llmProvider]) ??
        DEFAULT_MODELS[llmProvider],
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
    if (body.llmProvider !== undefined) overlay.LLM_PROVIDER = body.llmProvider;
    if (body.openaiApiKey !== undefined)
      overlay.OPENAI_API_KEY = body.openaiApiKey;
    if (body.geminiApiKey !== undefined)
      overlay.GEMINI_API_KEY = body.geminiApiKey;
    if (body.smtpHost !== undefined) overlay.SMTP_HOST = body.smtpHost;
    if (body.smtpPort !== undefined) overlay.SMTP_PORT = String(body.smtpPort);
    if (body.smtpUser !== undefined) overlay.SMTP_USER = body.smtpUser;
    if (body.smtpPass !== undefined) overlay.SMTP_PASS = body.smtpPass;
    if (body.emailFrom !== undefined) overlay.EMAIL_FROM = body.emailFrom;
    // A model belongs to a provider, so it is written under the provider this
    // request selects — a form that switches to Gemini and names a model in the
    // same submit must not leave that model on the OpenAI vars.
    const provider = body.llmProvider ?? this.provider();
    if (body.commitAnalysisModel !== undefined)
      overlay[COMMIT_ANALYSIS_MODEL_VARS[provider]] = body.commitAnalysisModel;
    if (body.briefModel !== undefined)
      overlay[BRIEF_MODEL_VARS[provider]] = body.briefModel;

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
