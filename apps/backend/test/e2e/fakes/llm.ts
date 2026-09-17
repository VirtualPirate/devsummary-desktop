import type { OpenAiCall } from '../../../src/__mocks__/openai';

export interface LlmFake {
  /** One entry per provider call, in order. */
  calls: OpenAiCall[];
  /** The body every `commit_analysis` call answers with from now on. */
  analysis(body: Record<string, unknown>): void;
  /** The body every `brief_output` call answers with from now on. */
  brief(body: Record<string, unknown>): void;
  tokens(input: number, output: number): void;
  /** Reject the next `times` calls — the retryable-transport path. */
  failNext(error: Error, times?: number): void;
  /** Answer the next `times` calls with a body the Zod schema rejects. */
  malformedNext(times?: number): void;
  reset(): void;
}

const DEFAULT_ANALYSIS = {
  commit_type: 'chore',
  summary: 'mock analysis',
  changes: ['mock change'],
};
const DEFAULT_BRIEF = {
  title: 'Mock brief',
  summary: 'Mock brief summary.',
  highlights: [],
};

export async function installLlm(): Promise<LlmFake> {
  const openai = (await import('openai')) as unknown as {
    __reset: () => void;
    __setHandler: (h: ((call: OpenAiCall) => unknown) | null) => void;
  };
  openai.__reset();

  const calls: OpenAiCall[] = [];
  let analysisBody: Record<string, unknown> = { ...DEFAULT_ANALYSIS };
  let briefBody: Record<string, unknown> = { ...DEFAULT_BRIEF };
  let usage = { input_tokens: 10, output_tokens: 20 };
  let failures: { error: Error; remaining: number } | null = null;
  let malformed = 0;

  openai.__setHandler((call: OpenAiCall) => {
    calls.push(call);

    if (failures) {
      failures.remaining -= 1;
      const error = failures.error;
      if (failures.remaining <= 0) failures = null;
      throw error;
    }

    if (malformed > 0) {
      malformed -= 1;
      // Structurally valid JSON, wrong shape: the `invalid` path, which must
      // not be retried like a network fault.
      return { output_parsed: { nonsense: true }, usage };
    }

    const body =
      call.schemaName === 'brief_output' ? briefBody : analysisBody;
    return { output_parsed: body, usage };
  });

  return {
    calls,
    analysis: (body) => {
      analysisBody = body;
    },
    brief: (body) => {
      briefBody = body;
    },
    tokens: (input, output) => {
      usage = { input_tokens: input, output_tokens: output };
    },
    failNext: (error, times = 1) => {
      failures = { error, remaining: times };
    },
    malformedNext: (times = 1) => {
      malformed = times;
    },
    reset: () => {
      calls.length = 0;
      analysisBody = { ...DEFAULT_ANALYSIS };
      briefBody = { ...DEFAULT_BRIEF };
      usage = { input_tokens: 10, output_tokens: 20 };
      failures = null;
      malformed = 0;
    },
  };
}
