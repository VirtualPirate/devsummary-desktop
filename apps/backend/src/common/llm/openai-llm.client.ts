import { AppError } from '../errors';
import {
  LlmClient,
  type ProviderRequest,
  type ProviderResponse,
} from './llm-client';

/**
 * OpenAI proper, over the Responses API — the one endpoint that takes a Zod
 * schema directly (`zodTextFormat`) and hands back an already-parsed object,
 * so there is no JSON string to decode here.
 */
export class OpenAiLlmClient extends LlmClient {
  protected async request({
    client,
    zodTextFormat,
    schema,
    schemaName,
    messages,
  }: ProviderRequest): Promise<ProviderResponse> {
    const response = await client.responses.parse({
      model: this.model,
      input: messages,
      text: { format: zodTextFormat(schema, schemaName) },
    });

    if (!response.output_parsed) {
      throw AppError.OPENAI_RESPONSE_INVALID({
        reason: 'output_parsed was empty',
      });
    }

    return {
      raw: response.output_parsed,
      // Responses reports usage under different keys than chat completions.
      promptTokens: response.usage?.input_tokens ?? null,
      completionTokens: response.usage?.output_tokens ?? null,
    };
  }
}
