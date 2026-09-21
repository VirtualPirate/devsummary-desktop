import { dirname, resolve } from 'node:path';
import {
  BadRequestException,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { z } from 'zod';
import type {
  AgentCliStatus,
  LlmProviderName,
  LocalSettingsStatus,
  LocalSettingsTestResult,
  UpdateLocalCredentialsRequest,
} from '@launchstack/api-interfaces';
import { AGENT_MODEL_VARS } from '../../agents/agents.config';
import { BRIEF_MODEL_VARS } from '../../briefs/briefs-config';
import {
  AGENT_ADAPTERS,
  AgentCliDetector,
  AgentCliLlmClient,
  DEFAULT_MODELS,
  LLM_PROVIDERS,
  isAgentProvider,
  type AgentProvider,
} from '../../common/llm';
import { resolveDataDir } from '../../databases/kysely/kysely.module';
import { COMMIT_ANALYSIS_MODEL_VARS } from '../../integrations/github/commit-analysis/commit-analysis.config';
import { LocalSettingsRepository } from './local-settings.repository';
import { SecretsService, type SecretBundle } from './secrets.service';

/**
 * The smallest structured answer that still proves the whole path: argv, stdin,
 * the JSON schema, the model and the envelope.
 */
const AgentCliTestSchema = z.object({ ok: z.boolean() });

@Injectable()
export class LocalSettingsService implements OnModuleInit {
  private readonly logger = new Logger(LocalSettingsService.name);

  constructor(
    private readonly secrets: SecretsService,
    private readonly settings: LocalSettingsRepository,
    // Imported as a value, not `import type`: this is the DI token, and an
    // `import type` erases the class and drops it from `design:paramtypes`.
    private readonly detector: AgentCliDetector,
  ) {}

  /**
   * Not awaited: detection can spawn a login shell per CLI, and boot must not
   * wait on it — nothing can be answered before the renderer has a provider
   * anyway, and the settings screen reads the result on its next status call.
   */
  onModuleInit(): void {
    void this.autoSelectAgentCli();
  }

  /**
   * First launch with a coding-agent CLI already installed: pick it, so the app
   * is usable without pasting a key. Only when the install has made no choice at
   * all — a stored `LLM_PROVIDER` is the user's, and an OpenAI key with the
   * default provider is a working configuration this must not move off.
   */
  private async autoSelectAgentCli(): Promise<void> {
    if (this.secrets.get('LLM_PROVIDER') || this.secrets.aiConfigured()) return;

    const installed = (await this.detector.detectAll()).find(
      (c) => c.installed,
    );
    if (!installed) return;

    this.secrets.update({ LLM_PROVIDER: installed.id });
    this.logger.log(
      `Auto-selected ${installed.displayName} as the AI provider`,
    );
  }

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
      // `DATA_DIR` itself — the `userData` root — not the `data/` child that
      // `resolveDataDir()` returns. The screen that prints this also says the
      // logs and `secrets.bin` are in it, and its Open button reveals
      // `app.getPath('userData')`; naming the PGlite directory instead sent
      // anyone following that copy into a folder holding neither, one level
      // below the one the button had just opened.
      //
      // Absolute, because the headless fallback is the relative `./.data` and a
      // path the user cannot paste into Finder is not an answer.
      dataDir: resolve(process.env.DATA_DIR ?? dirname(resolveDataDir())),
      // The effective model for the *selected* provider: an OpenAI override is
      // still stored while Gemini is selected, and reporting it would put a
      // model the run will never use in front of the user.
      commitAnalysisModel:
        this.secrets.get(COMMIT_ANALYSIS_MODEL_VARS[llmProvider]) ??
        DEFAULT_MODELS[llmProvider].commitAnalysis,
      briefModel:
        this.secrets.get(BRIEF_MODEL_VARS[llmProvider]) ??
        DEFAULT_MODELS[llmProvider].brief,
      agentModel:
        this.secrets.get(AGENT_MODEL_VARS[llmProvider]) ??
        DEFAULT_MODELS[llmProvider].agent,
    };
  }

  /**
   * Credentials are proved before they are stored — an agent CLI by detecting
   * its binary. Without that, a typo'd value surfaces days later as a failed
   * brief instead of a red field.
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
    // A model belongs to a provider, so it is written under the provider this
    // request selects — a form that switches to Gemini and names a model in the
    // same submit must not leave that model on the OpenAI vars.
    const provider = body.llmProvider ?? this.provider();
    if (body.commitAnalysisModel !== undefined)
      overlay[COMMIT_ANALYSIS_MODEL_VARS[provider]] = body.commitAnalysisModel;
    if (body.briefModel !== undefined)
      overlay[BRIEF_MODEL_VARS[provider]] = body.briefModel;
    if (body.agentModel !== undefined)
      overlay[AGENT_MODEL_VARS[provider]] = body.agentModel;

    // A CLI provider is proved before it is stored. Not-logged-in is
    // deliberately allowed: the card warns, and the fix (`claude` then
    // `/login`) is outside this app.
    if (body.llmProvider !== undefined && isAgentProvider(body.llmProvider)) {
      const cli = await this.detector.detect(body.llmProvider, { force: true });
      if (!cli.installed) {
        throw new BadRequestException(
          `${cli.displayName} is not installed. ${cli.installHint}`,
        );
      }
    }

    if (Object.keys(overlay).length > 0) this.secrets.update(overlay);
    if (body.desktopNotifications !== undefined) {
      await this.settings.setDesktopNotifications(body.desktopNotifications);
    }

    return this.status();
  }

  /**
   * Machine-wide and slow-ish to compute — it can spawn a login shell — which
   * is why it is its own endpoint instead of two more booleans on `status()`.
   */
  agentClis(refresh: boolean): Promise<AgentCliStatus[]> {
    return this.detector.detectAll(refresh);
  }

  /**
   * One real structured call through the real client, so a broken install shows
   * up here rather than hours later on a failed brief. Built with the injected
   * detector so the `force` probe just done is the cache this call reads.
   */
  async testAgentCli(id: AgentProvider): Promise<LocalSettingsTestResult> {
    const cli = await this.detector.detect(id, { force: true });
    if (!cli.installed) {
      throw new BadRequestException(
        `${cli.displayName} is not installed. ${cli.installHint}`,
      );
    }

    const model =
      this.secrets.get(COMMIT_ANALYSIS_MODEL_VARS[id]) ??
      DEFAULT_MODELS[id].commitAnalysis;
    const client = new AgentCliLlmClient(
      { provider: id, model },
      AGENT_ADAPTERS[id],
      this.detector,
    );

    const started = Date.now();
    let answered: string;
    try {
      const result = await client.parse(AgentCliTestSchema, 'agent_cli_test', {
        systemPrompt:
          'You are a connectivity probe. Answer only with the requested structured output.',
        userPrompt: 'Reply with ok: true',
      });
      answered = result.model;
    } catch (err) {
      throw new BadRequestException(
        `${cli.displayName} test failed: ${describe(err)}`,
      );
    }

    const detail = `${cli.displayName} answered with ${answered} in ${Date.now() - started} ms`;
    this.logger.log(`Agent CLI test ok id=${id} model=${answered}`);
    return { ok: true, detail };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
