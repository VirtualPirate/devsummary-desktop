type ParsedResponse = {
  output_parsed: {
    commit_type: string;
    summary: string;
    changes: string[];
  };
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
      parse: jest.fn(async () => __defaultParsed),
    };
    OpenAI.__instances.push(this);
  }
}

export const __zodTextFormat = (_schema: unknown, name: string) => ({
  __format: 'json_schema',
  name,
});
