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

export const __reset = () => {
  OpenAI.__instances = [];
};

export default class OpenAI {
  static __instances: OpenAI[] = [];

  apiKey: string;
  responses: { parse: jest.Mock };

  constructor(opts: { apiKey: string }) {
    this.apiKey = opts.apiKey;
    this.responses = {
      parse: jest.fn(async (args: ParseArgs = {}) =>
        args.text?.format?.name === 'brief_output'
          ? __defaultBriefParsed
          : __defaultParsed,
      ),
    };
    OpenAI.__instances.push(this);
  }
}

export const __zodTextFormat = (_schema: unknown, name: string) => ({
  __format: 'json_schema',
  name,
});
