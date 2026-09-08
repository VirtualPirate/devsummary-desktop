import { AppError } from '../errors';
import { LlmClient, type ProviderResponse } from './llm-client';

/**
 * The graceful-degradation stub: a module whose provider has no API key still
 * boots, and the first call fails with the registered code instead of a
 * TypeError stored as some brief's `failure_reason`.
 *
 * `parse()` is overridden rather than `request()` implemented, because the base
 * template loads the SDK and constructs a client before it ever reaches the
 * transport — work there is no key for. `request()` is therefore unreachable.
 */
export class UnconfiguredLlmClient extends LlmClient {
  constructor() {
    super({ provider: 'openai', apiKey: '', model: '' });
  }

  parse(): Promise<never> {
    return Promise.reject(AppError.OPENAI_NOT_CONFIGURED());
  }

  protected request(): Promise<ProviderResponse> {
    return Promise.reject(AppError.OPENAI_NOT_CONFIGURED());
  }
}
