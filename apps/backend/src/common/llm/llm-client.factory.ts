import {
  AGENT_ADAPTERS,
  AgentCliLlmClient,
  agentCliDetector,
  isAgentProvider,
  type AgentProvider,
} from './agents';
import { GeminiLlmClient } from './gemini-llm.client';
import type { LlmClient } from './llm-client';
import type { LlmProvider, LlmSettings } from './llm-config';
import { OpenAiLlmClient } from './openai-llm.client';
import { UnconfiguredLlmClient } from './unconfigured-llm.client';

/**
 * Keyed by provider rather than switched on, so adding one to `LLM_PROVIDERS`
 * without writing its client is a compile error here instead of a silent
 * fall-through to OpenAI at runtime.
 *
 * Agent CLIs are excluded: they all share one class parameterised by an
 * adapter, so the exhaustiveness that matters for them is `AGENT_ADAPTERS`, and
 * naming each one here again would make a new adapter two edits instead of one.
 */
const SDK_CLIENT_BY_PROVIDER: Record<
  Exclude<LlmProvider, AgentProvider>,
  (settings: LlmSettings) => LlmClient
> = {
  openai: (settings) => new OpenAiLlmClient(settings),
  gemini: (settings) => new GeminiLlmClient(settings),
};

/**
 * Null settings mean the selected provider had no API key — every consuming
 * module hands that straight through, so the stub is the fallback rather than a
 * boot failure.
 */
export function createLlmClient(settings: LlmSettings | null): LlmClient {
  if (!settings) return new UnconfiguredLlmClient();
  return isAgentProvider(settings.provider)
    ? new AgentCliLlmClient(
        settings,
        AGENT_ADAPTERS[settings.provider],
        agentCliDetector,
      )
    : SDK_CLIENT_BY_PROVIDER[settings.provider](settings);
}
