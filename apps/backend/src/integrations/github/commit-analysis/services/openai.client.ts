import { createRequire } from 'node:module';
import { AppError } from '../../../../common/errors';
import type { CommitAnalysisConfig } from '../commit-analysis.config';
import {
  CommitAnalysisOutputSchema,
  type CommitAnalysisOutput,
} from '../schemas/analysis-output.schema';

type ResponsesParseArgs = {
  model: string;
  input: Array<{ role: 'system' | 'user'; content: string }>;
  text: { format: unknown };
};

type ResponsesParseResult = {
  output_parsed: CommitAnalysisOutput | null;
  usage?: { input_tokens?: number; output_tokens?: number };
};

type OpenAIInstance = {
  responses: {
    parse: (args: ResponsesParseArgs) => Promise<ResponsesParseResult>;
  };
};

type OpenAIConstructor = new (opts: { apiKey: string }) => OpenAIInstance;
type ZodTextFormatFn = (schema: unknown, name: string) => unknown;

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

export interface AnalyzeArgs {
  systemPrompt: string;
  userPrompt: string;
}

export interface AnalyzeResult {
  parsed: CommitAnalysisOutput;
  promptTokens: number | null;
  completionTokens: number | null;
}

export class OpenAIClient {
  private sdkPromise: Promise<{
    client: OpenAIInstance;
    zodTextFormat: ZodTextFormatFn;
  }> | null = null;

  constructor(private readonly config: CommitAnalysisConfig) {}

  private async getSdk() {
    if (!this.sdkPromise) {
      this.sdkPromise = loadSdk().then(({ OpenAI, zodTextFormat }) => ({
        client: new OpenAI({ apiKey: this.config.apiKey }),
        zodTextFormat,
      }));
    }
    return this.sdkPromise;
  }

  async analyze(args: AnalyzeArgs): Promise<AnalyzeResult> {
    const { client, zodTextFormat } = await this.getSdk();
    let response: ResponsesParseResult;
    try {
      response = await client.responses.parse({
        model: this.config.model,
        input: [
          { role: 'system', content: args.systemPrompt },
          { role: 'user', content: args.userPrompt },
        ],
        text: {
          format: zodTextFormat(CommitAnalysisOutputSchema, 'commit_analysis'),
        },
      });
    } catch (err) {
      throw AppError.OPENAI_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    if (!response.output_parsed) {
      throw AppError.OPENAI_RESPONSE_INVALID({
        reason: 'output_parsed was empty',
      });
    }

    const validation = CommitAnalysisOutputSchema.safeParse(
      response.output_parsed,
    );
    if (!validation.success) {
      throw AppError.OPENAI_RESPONSE_INVALID({
        reason: validation.error.message,
      });
    }

    return {
      parsed: validation.data,
      promptTokens: response.usage?.input_tokens ?? null,
      completionTokens: response.usage?.output_tokens ?? null,
    };
  }
}
