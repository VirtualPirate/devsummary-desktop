import type { ConfigService } from '@nestjs/config';
import {
  loadLlmSettings,
  type LlmProvider,
  type LlmSettings,
} from '../common/llm';

/**
 * Injection token for the resolved config. Declared here rather than in
 * `agents.module.ts` so controllers can inject it without importing their own
 * module back (a cycle Nest's decorator evaluation does not survive).
 */
export const AGENTS_CONFIG = Symbol('AGENTS_CONFIG');

/**
 * The agent model override per provider. Also read by the settings screen,
 * exactly like `BRIEF_MODEL_VARS`. The defaults themselves live in
 * `DEFAULT_MODELS[provider].agent`.
 */
export const AGENT_MODEL_VARS = {
  openai: 'OPENAI_AGENT_MODEL',
  gemini: 'GEMINI_AGENT_MODEL',
  'claude-code': 'CLAUDE_CODE_AGENT_MODEL',
  opencode: 'OPENCODE_AGENT_MODEL',
  cursor: 'CURSOR_AGENT_MODEL',
  codex: 'CODEX_AGENT_MODEL',
} as const satisfies Record<LlmProvider, string>;

export interface AgentsConfig {
  /**
   * The provider, key and model to use **right now**, or null when the selected
   * provider has no key yet. A getter, not a value — see the note below.
   */
  readonly llm: LlmSettings | null;
}

/**
 * `llm` is a **getter**, the same shape as `loadBriefsConfig`: the settings
 * screen writes the provider, the key and the model override long after the
 * module graph is built, so a snapshot would need a relaunch to take effect.
 *
 * There is no enable flag and no `DATABASE_URL`. The cloud original had both —
 * `AGENTS_ENABLED` because the feature was rolling out, and a connection string
 * because its checkpointer opened its own pool. Here the agent is available
 * whenever a provider is configured, and the checkpointer runs on the app's own
 * PGlite through `createPglitePool`. A null `llm` is the not-configured signal,
 * raised as `OPENAI_NOT_CONFIGURED` when a run asks for a model.
 */
export function loadAgentsConfig(config: ConfigService): AgentsConfig {
  return {
    get llm(): LlmSettings | null {
      return loadLlmSettings(config, {
        providerVar: 'AGENTS_LLM_PROVIDER',
        modelVars: AGENT_MODEL_VARS,
        job: 'agent',
      });
    },
  };
}
