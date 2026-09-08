import type { z } from 'zod';
import { AppError } from '../errors';
import {
  LlmClient,
  type ProviderResponse,
  type StructuredParseResult,
  type StructuredPromptArgs,
} from './llm-client';
import { createLlmClient } from './llm-client.factory';
import type { LlmSettings } from './llm-config';

/**
 * The desktop translation of the source's boot-time provider choice.
 *
 * On a webapp install the provider, the key and the model overrides are env at
 * fork time, so `createLlmClient(loadLlmSettings(...))` in a module factory is
 * correct for the life of the process. Here they are written by the settings
 * screen into `SecretsService` → `process.env` → `ConfigService`, so the same
 * factory would pin whatever was configured at boot: switching to Gemini, or
 * pasting the first key at all, would need a relaunch.
 *
 * So the provider is chosen **per call**: `parse()` re-resolves the settings and
 * delegates to the client for them. The delegate is cached while those settings
 * are unchanged — otherwise every analysed commit would construct a new SDK
 * client — and a key rotation or a model change invalidates it, which is what
 * makes the next job pick up the edit.
 */
export class LiveLlmClient extends LlmClient {
  private delegate: { key: string; client: LlmClient } | null = null;

  constructor(private readonly resolve: () => LlmSettings | null) {
    super({ provider: 'openai', apiKey: '', model: '' });
  }

  // `async` so a synchronous throw out of `resolve()` — `resolveLlmProvider`
  // rejects an unknown provider rather than falling back — reaches the caller
  // as a rejected promise like every other failure on this path.
  async parse<T>(
    schema: z.ZodType<T>,
    schemaName: string,
    args: StructuredPromptArgs,
  ): Promise<StructuredParseResult<T>> {
    const settings = this.resolve();
    // Null (no key for the selected provider) keys as '', so the stub is cached
    // like any other delegate and one pasted key swaps it out.
    const key = settings
      ? JSON.stringify([settings.provider, settings.apiKey, settings.model])
      : '';
    if (this.delegate?.key !== key) {
      this.delegate = { key, client: createLlmClient(settings) };
    }
    return this.delegate.client.parse(schema, schemaName, args);
  }

  /** Unreachable: `parse()` never reaches the base template. */
  protected request(): Promise<ProviderResponse> {
    return Promise.reject(AppError.OPENAI_NOT_CONFIGURED());
  }
}
