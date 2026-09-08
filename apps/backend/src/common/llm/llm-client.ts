import { createRequire } from 'node:module';
import type { z } from 'zod';
import { ApiException, AppError } from '../errors';
import type { LlmProvider, LlmSettings } from './llm-config';

export type ChatMessage = { role: 'system' | 'user'; content: string };

type ResponsesParseArgs = {
  model: string;
  input: ChatMessage[];
  text: { format: unknown };
};

type ResponsesParseResult = {
  output_parsed: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
};

type ChatCompletionArgs = {
  model: string;
  messages: ChatMessage[];
  response_format: unknown;
};

type ChatCompletionResult = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type OpenAIInstance = {
  responses: {
    parse: (args: ResponsesParseArgs) => Promise<ResponsesParseResult>;
  };
  chat: {
    completions: {
      create: (args: ChatCompletionArgs) => Promise<ChatCompletionResult>;
    };
  };
};

type OpenAIConstructor = new (opts: {
  apiKey: string;
  baseURL?: string;
}) => OpenAIInstance;

export type ZodTextFormatFn = (schema: unknown, name: string) => unknown;

/**
 * The import shape has to differ by runtime, not by taste: `openai` is ESM-only
 * and Jest runs CJS, so under Jest only a `createRequire` call reaches the
 * manual mock wired up in `moduleNameMapper` — a dynamic `import()` there fails
 * to load at all.
 */
async function loadSdk(): Promise<{
  OpenAI: OpenAIConstructor;
  zodTextFormat: ZodTextFormatFn;
}> {
  if (process.env.JEST_WORKER_ID) {
    const req = createRequire(__filename);
    const root = req('openai') as { default: OpenAIConstructor };
    const helpers = req('openai/helpers/zod') as {
      zodTextFormat: ZodTextFormatFn;
    };
    return { OpenAI: root.default, zodTextFormat: helpers.zodTextFormat };
  }
  const root = (await import('openai')) as unknown as {
    default: OpenAIConstructor;
  };
  const helpers = (await import('openai/helpers/zod')) as unknown as {
    zodTextFormat: ZodTextFormatFn;
  };
  return { OpenAI: root.default, zodTextFormat: helpers.zodTextFormat };
}

export interface StructuredPromptArgs {
  systemPrompt: string;
  userPrompt: string;
}

export interface StructuredParseResult<T> {
  parsed: T;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

/** Everything a subclass needs to issue one request, and nothing else. */
export interface ProviderRequest {
  client: OpenAIInstance;
  zodTextFormat: ZodTextFormatFn;
  schema: z.ZodType;
  schemaName: string;
  messages: ChatMessage[];
}

/** A provider's answer, before it is validated against the Zod schema. */
export interface ProviderResponse {
  raw: unknown;
  promptTokens: number | null;
  completionTokens: number | null;
}

/**
 * One structured-output call, one type, any provider. Swapping providers is an
 * env change (`LLM_PROVIDER` / `<SCOPE>_LLM_PROVIDER`); nothing above this
 * class knows which one answered.
 *
 * Everything that is *not* provider-specific lives here — SDK loading, error
 * mapping, Zod validation, the result shape — so a subclass is only the request
 * a provider's endpoint actually accepts. That is the whole seam: `request()`
 * plus, where it differs, `baseUrl`.
 */
export abstract class LlmClient {
  private sdkPromise: Promise<{
    client: OpenAIInstance;
    zodTextFormat: ZodTextFormatFn;
  }> | null = null;

  constructor(protected readonly settings: LlmSettings) {}

  get model(): string {
    return this.settings.model;
  }

  get provider(): LlmProvider {
    return this.settings.provider;
  }

  /** The SDK's own default unless a subclass is reached somewhere else. */
  protected get baseUrl(): string | undefined {
    return this.settings.baseURL;
  }

  /**
   * Issue the request and report what came back. Anything a subclass can tell
   * is a bad *body* (empty output, unparseable JSON) must be raised here as
   * `OPENAI_RESPONSE_INVALID` — `parse()` lets that through untouched.
   */
  protected abstract request(req: ProviderRequest): Promise<ProviderResponse>;

  async parse<T>(
    schema: z.ZodType<T>,
    schemaName: string,
    args: StructuredPromptArgs,
  ): Promise<StructuredParseResult<T>> {
    const { client, zodTextFormat } = await this.getSdk();
    const messages: ChatMessage[] = [
      { role: 'system', content: args.systemPrompt },
      { role: 'user', content: args.userPrompt },
    ];

    let response: ProviderResponse;
    try {
      response = await this.request({
        client,
        zodTextFormat,
        schema,
        schemaName,
        messages,
      });
    } catch (err) {
      // A subclass that already judged the response garbage says so with an
      // `ApiException`; re-wrapping it as `OPENAI_API_FAILED` would put a
      // malformed body back on the retry path meant for transport blips.
      if (err instanceof ApiException) throw err;
      throw AppError.OPENAI_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    const validation = schema.safeParse(response.raw);
    if (!validation.success) {
      throw AppError.OPENAI_RESPONSE_INVALID({
        reason: validation.error.message,
      });
    }

    return {
      parsed: validation.data,
      model: this.settings.model,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
    };
  }

  /**
   * Lazy and cached per instance: constructing a client at DI time would load
   * the SDK on every boot, including the boots that never make a call.
   */
  private async getSdk() {
    if (!this.sdkPromise) {
      this.sdkPromise = loadSdk().then(({ OpenAI, zodTextFormat }) => ({
        client: new OpenAI({
          apiKey: this.settings.apiKey,
          ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
        }),
        zodTextFormat,
      }));
    }
    return this.sdkPromise;
  }
}
