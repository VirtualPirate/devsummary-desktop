import { GeminiLlmClient } from './gemini-llm.client';
import type { LlmClient } from './llm-client';
import type { LlmProvider, LlmSettings } from './llm-config';
import { OpenAiLlmClient } from './openai-llm.client';
import { UnconfiguredLlmClient } from './unconfigured-llm.client';

/**
 * Keyed by `LlmProvider` rather than switched on, so adding a provider to
 * `LLM_PROVIDERS` without writing its subclass is a compile error here instead
 * of a silent fall-through to OpenAI at runtime.
 */
const CLIENT_BY_PROVIDER: Record<
  LlmProvider,
  new (settings: LlmSettings) => LlmClient
> = {
  openai: OpenAiLlmClient,
  gemini: GeminiLlmClient,
};

/**
 * Null settings mean the selected provider had no API key — every consuming
 * module hands that straight through, so the stub is the fallback rather than a
 * boot failure.
 */
export function createLlmClient(settings: LlmSettings | null): LlmClient {
  return settings
    ? new CLIENT_BY_PROVIDER[settings.provider](settings)
    : new UnconfiguredLlmClient();
}
