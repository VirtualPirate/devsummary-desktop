import { AppError } from '../errors';
import { toGeminiJsonSchema } from './gemini-schema';
import {
  LlmClient,
  type ProviderRequest,
  type ProviderResponse,
} from './llm-client';
import { GEMINI_BASE_URL } from './llm-config';

/**
 * Gemini through its OpenAI-compatible endpoint, which is what lets one SDK
 * serve both providers. It implements `/chat/completions` and *not*
 * `/responses`, so the schema goes over as JSON Schema (`toGeminiJsonSchema`
 * prunes it to the keywords Gemini accepts) and the answer comes back as a
 * string that still needs decoding.
 */
export class GeminiLlmClient extends LlmClient {
  // The compat base belongs to the provider, not to the operator's env: built
  // from settings that omitted it, this class would send a Gemini key to
  // api.openai.com and the 401 would read as a transport failure.
  protected get baseUrl(): string {
    return GEMINI_BASE_URL;
  }

  protected async request({
    client,
    schema,
    schemaName,
    messages,
  }: ProviderRequest): Promise<ProviderResponse> {
    const response = await client.chat.completions.create({
      model: this.model,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schemaName,
          schema: toGeminiJsonSchema(schema),
          strict: true,
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw AppError.OPENAI_RESPONSE_INVALID({
        reason: 'response content was empty',
      });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch (err) {
      // Deliberately `OPENAI_RESPONSE_INVALID`, never `OPENAI_API_FAILED`: a
      // garbage body is not a transport blip and must not be retried as one.
      throw AppError.OPENAI_RESPONSE_INVALID({
        reason: `response was not valid JSON: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      });
    }

    return {
      raw,
      promptTokens: response.usage?.prompt_tokens ?? null,
      completionTokens: response.usage?.completion_tokens ?? null,
    };
  }
}
