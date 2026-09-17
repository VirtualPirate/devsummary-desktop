type ParsedResponse = {
  output_parsed: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export const __defaultParsed: ParsedResponse = {
  output_parsed: {
    commit_type: 'chore',
    summary: 'mock analysis',
    changes: ['mock change'],
  },
  usage: { input_tokens: 10, output_tokens: 20 },
};

/**
 * Both callers go through `responses.parse`, and their Zod schemas disagree —
 * a commit analysis validated against `BriefOutputSchema` fails. The schema
 * name is already on the request (`zodTextFormat(schema, name)`), so the mock
 * answers whichever shape was asked for instead of making every brief test
 * stub its own response.
 */
export const __defaultBriefParsed: ParsedResponse = {
  output_parsed: {
    title: 'Mock brief',
    summary: 'Mock brief summary.',
    highlights: [],
  },
  usage: { input_tokens: 30, output_tokens: 40 },
};

type ParseArgs = { text?: { format?: { name?: string } } };
/** Gemini goes through `/chat/completions`, which names the schema here. */
type ChatArgs = { response_format?: { json_schema?: { name?: string } } };

export interface OpenAiCall {
  kind: 'responses' | 'chat';
  schemaName?: string;
  model?: string;
  messages: unknown;
}

/**
 * The e2e fakes layer's seam. Left null by the Jest unit suites, which is why
 * the default answers below are still what they get. A handler may return a
 * body or throw — a throw is how a provider failure is simulated.
 */
export type OpenAiHandler = (call: OpenAiCall) => ParsedResponse;
let handler: OpenAiHandler | null = null;
export const __setHandler = (h: OpenAiHandler | null) => {
  handler = h;
};

const bySchemaName = (name: string | undefined): ParsedResponse =>
  name === 'brief_output' ? __defaultBriefParsed : __defaultParsed;

const answer = (call: OpenAiCall): ParsedResponse =>
  handler ? handler(call) : bySchemaName(call.schemaName);

export const __reset = () => {
  OpenAI.__instances = [];
  handler = null;
};

export default class OpenAI {
  static __instances: OpenAI[] = [];

  apiKey: string;
  baseURL?: string;
  responses: { parse: jest.Mock };
  chat: { completions: { create: jest.Mock } };

  constructor(opts: { apiKey: string; baseURL?: string }) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL;
    this.responses = {
      parse: jest.fn(
        (args: ParseArgs & { model?: string; input?: unknown } = {}) =>
          Promise.resolve(
            answer({
              kind: 'responses',
              schemaName: args.text?.format?.name,
              model: args.model,
              messages: args.input,
            }),
          ),
      ),
    };
    // Chat completions answer with a JSON *string* and report usage under
    // different keys, which is the whole difference `GeminiLlmClient` handles.
    this.chat = {
      completions: {
        create: jest.fn(
          (args: ChatArgs & { model?: string; messages?: unknown } = {}) => {
            const picked = answer({
              kind: 'chat',
              schemaName: args.response_format?.json_schema?.name,
              model: args.model,
              messages: args.messages,
            });
            return Promise.resolve({
              choices: [
                { message: { content: JSON.stringify(picked.output_parsed) } },
              ],
              usage: {
                prompt_tokens: picked.usage?.input_tokens,
                completion_tokens: picked.usage?.output_tokens,
              },
            });
          },
        ),
      },
    };
    OpenAI.__instances.push(this);
  }
}

export const __zodTextFormat = (_schema: unknown, name: string) => ({
  __format: 'json_schema',
  name,
});
