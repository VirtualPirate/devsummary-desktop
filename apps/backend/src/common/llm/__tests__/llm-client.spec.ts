/* eslint-disable @typescript-eslint/no-require-imports */

const OpenAIModule = require('openai');
const OpenAI = OpenAIModule.default;

import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import {
  AgentCliLlmClient,
  DEFAULT_MODELS,
  GEMINI_BASE_URL,
  GeminiLlmClient,
  LLM_PROVIDERS,
  LiveLlmClient,
  LlmClient,
  OpenAiLlmClient,
  type ProviderResponse,
  UnconfiguredLlmClient,
  createLlmClient,
  loadLlmSettings,
  resolveLlmProvider,
  toGeminiJsonSchema,
} from '..';
import { CommitAnalysisOutputSchema } from '../../../integrations/github/commit-analysis/schemas/analysis-output.schema';

const prompts = { systemPrompt: 'sys', userPrompt: 'user' };

function openAiClient() {
  return new OpenAiLlmClient({
    provider: 'openai',
    apiKey: 'sk-test',
    model: 'gpt-4o-mini',
  });
}

// Deliberately no `baseURL` in the settings: the compat base is the subclass's
// business, and a client that only got it from env would quietly hit OpenAI.
function geminiClient() {
  return new GeminiLlmClient({
    provider: 'gemini',
    apiKey: 'gem-test',
    model: 'gemini-3.6-flash',
  });
}

function instances(): any[] {
  return OpenAI.__instances as any[];
}

describe('OpenAiLlmClient', () => {
  beforeEach(() => {
    OpenAI.__instances = [];
  });

  it('calls responses.parse with the configured model and no baseURL override', async () => {
    const result = await openAiClient().parse(
      CommitAnalysisOutputSchema,
      'commit_analysis',
      prompts,
    );

    expect(instances()).toHaveLength(1);
    expect(instances()[0].baseURL).toBeUndefined();
    expect(instances()[0].responses.parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        input: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'user' },
        ],
        text: expect.objectContaining({
          format: expect.objectContaining({ name: 'commit_analysis' }),
        }),
      }),
    );
    expect(result.parsed.commit_type).toBe('chore');
    expect(result.promptTokens).toBe(10);
    expect(result.completionTokens).toBe(20);
  });

  // The SDK is loaded and the client constructed once per instance, not once
  // per call — a second `parse` must not build a second OpenAI client.
  it('reuses the cached SDK client across calls', async () => {
    const client = openAiClient();
    await client.parse(CommitAnalysisOutputSchema, 'x', prompts);
    await client.parse(CommitAnalysisOutputSchema, 'x', prompts);

    expect(instances()).toHaveLength(1);
    expect(instances()[0].responses.parse).toHaveBeenCalledTimes(2);
  });

  it('raises OPENAI_RESPONSE_INVALID when output_parsed is empty', async () => {
    const client = openAiClient();
    await client.parse(CommitAnalysisOutputSchema, 'x', prompts);
    instances()[0].responses.parse.mockResolvedValueOnce({
      output_parsed: null,
    });

    await expect(
      client.parse(CommitAnalysisOutputSchema, 'x', prompts),
    ).rejects.toMatchObject({ code: 'OPENAI_RESPONSE_INVALID' });
  });

  it('raises OPENAI_API_FAILED when the SDK rejects', async () => {
    const client = openAiClient();
    await client.parse(CommitAnalysisOutputSchema, 'x', prompts);
    instances()[0].responses.parse.mockRejectedValueOnce(new Error('boom'));

    await expect(
      client.parse(CommitAnalysisOutputSchema, 'x', prompts),
    ).rejects.toMatchObject({ code: 'OPENAI_API_FAILED' });
  });
});

describe('GeminiLlmClient', () => {
  beforeEach(() => {
    OpenAI.__instances = [];
  });

  // Gemini's compat endpoint has no `/responses`, so the same call has to
  // land on `/chat/completions` — with the SDK pointed at Gemini's base URL.
  it('routes through chat.completions against the compat base URL', async () => {
    const result = await geminiClient().parse(
      CommitAnalysisOutputSchema,
      'commit_analysis',
      prompts,
    );

    expect(instances()[0].baseURL).toBe(GEMINI_BASE_URL);
    expect(instances()[0].responses.parse).not.toHaveBeenCalled();
    expect(instances()[0].chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.6-flash',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'user' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: expect.objectContaining({ name: 'commit_analysis' }),
        },
      }),
    );
    expect(result.parsed.commit_type).toBe('chore');
    // Chat completions report usage under different keys than Responses.
    expect(result.promptTokens).toBe(10);
    expect(result.completionTokens).toBe(20);
  });

  it('raises OPENAI_RESPONSE_INVALID on a non-JSON body rather than API_FAILED', async () => {
    const client = geminiClient();
    await client.parse(CommitAnalysisOutputSchema, 'x', prompts);
    instances()[0].chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: 'not json' } }],
    });

    await expect(
      client.parse(CommitAnalysisOutputSchema, 'x', prompts),
    ).rejects.toMatchObject({ code: 'OPENAI_RESPONSE_INVALID' });
  });

  it('raises OPENAI_RESPONSE_INVALID on an empty body rather than API_FAILED', async () => {
    const client = geminiClient();
    await client.parse(CommitAnalysisOutputSchema, 'x', prompts);
    instances()[0].chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
    });

    await expect(
      client.parse(CommitAnalysisOutputSchema, 'x', prompts),
    ).rejects.toMatchObject({ code: 'OPENAI_RESPONSE_INVALID' });
  });

  it('raises OPENAI_RESPONSE_INVALID when the payload fails the Zod schema', async () => {
    const client = geminiClient();
    await client.parse(CommitAnalysisOutputSchema, 'x', prompts);
    instances()[0].chat.completions.create.mockResolvedValueOnce({
      choices: [{ message: { content: '{"commit_type":"nonsense"}' } }],
    });

    await expect(
      client.parse(CommitAnalysisOutputSchema, 'x', prompts),
    ).rejects.toMatchObject({ code: 'OPENAI_RESPONSE_INVALID' });
  });

  it('raises OPENAI_API_FAILED when the SDK rejects', async () => {
    const client = geminiClient();
    await client.parse(CommitAnalysisOutputSchema, 'x', prompts);
    instances()[0].chat.completions.create.mockRejectedValueOnce(
      new Error('boom'),
    );

    await expect(
      client.parse(CommitAnalysisOutputSchema, 'x', prompts),
    ).rejects.toMatchObject({ code: 'OPENAI_API_FAILED' });
  });
});

describe('UnconfiguredLlmClient', () => {
  beforeEach(() => {
    OpenAI.__instances = [];
  });

  // A missing key must not fail boot, and must not load the SDK either.
  it('rejects with OPENAI_NOT_CONFIGURED without constructing an SDK client', async () => {
    const client: LlmClient = new UnconfiguredLlmClient();

    await expect(
      client.parse(CommitAnalysisOutputSchema, 'x', prompts),
    ).rejects.toMatchObject({ code: 'OPENAI_NOT_CONFIGURED' });
    expect(instances()).toHaveLength(0);
  });
});

describe('createLlmClient', () => {
  it('maps each provider to its subclass and null to the stub', () => {
    expect(
      createLlmClient({ provider: 'openai', apiKey: 'sk', model: 'm' }),
    ).toBeInstanceOf(OpenAiLlmClient);
    expect(
      createLlmClient({ provider: 'gemini', apiKey: 'gm', model: 'm' }),
    ).toBeInstanceOf(GeminiLlmClient);
    expect(createLlmClient(null)).toBeInstanceOf(UnconfiguredLlmClient);
  });
});

// The abstract base is the DI token both modules provide under, which only
// works while the consuming service imports it as a *value* — an `import type`
// erases the class and `design:paramtypes` loses the token silently.
describe('LlmClient as a DI token', () => {
  @Injectable()
  class Consumer {
    constructor(readonly llm: LlmClient) {}
  }

  it('resolves an abstract-class provider into the injected field', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        Consumer,
        { provide: LlmClient, useFactory: () => createLlmClient(null) },
      ],
    }).compile();

    expect(mod.get(Consumer).llm).toBeInstanceOf(UnconfiguredLlmClient);
  });
});

describe('toGeminiJsonSchema', () => {
  it('drops the keywords Gemini rejects and keeps the ones it needs', () => {
    const schema = toGeminiJsonSchema(
      z.object({
        name: z.string().min(1).max(10),
        tags: z.array(z.string()).min(1).max(3),
        kind: z.enum(['a', 'b']),
      }),
    );

    expect(schema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 3,
        },
        kind: { type: 'string', enum: ['a', 'b'] },
      },
      required: ['name', 'tags', 'kind'],
    });
  });

  it('does not filter user field names that collide with schema keywords', () => {
    const schema = toGeminiJsonSchema(z.object({ type: z.string() })) as any;
    expect(schema.properties.type).toEqual({ type: 'string' });
  });
});

describe('provider resolution', () => {
  const cfg = (values: Record<string, string | undefined>) =>
    ({ get: (key: string) => values[key] }) as never;

  it('defaults to openai', () => {
    expect(resolveLlmProvider(cfg({}))).toBe('openai');
  });

  it('lets the scope var override the global one', () => {
    expect(
      resolveLlmProvider(
        cfg({ LLM_PROVIDER: 'openai', BRIEFS_LLM_PROVIDER: 'gemini' }),
        'BRIEFS_LLM_PROVIDER',
      ),
    ).toBe('gemini');
  });

  // Falling back to openai on a typo silently spends on the provider the
  // operator believed they had left.
  it('throws on an unknown provider instead of falling back', () => {
    expect(() => resolveLlmProvider(cfg({ LLM_PROVIDER: 'gemeni' }))).toThrow(
      /Invalid LLM_PROVIDER/,
    );
  });

  it('reads the gemini key and model when the provider is gemini', () => {
    expect(
      loadLlmSettings(
        cfg({
          LLM_PROVIDER: 'gemini',
          OPENAI_API_KEY: 'sk-test',
          GEMINI_API_KEY: 'gem-test',
          GEMINI_BRIEF_MODEL: 'gemini-2.5-pro',
        }),
        {
          providerVar: 'BRIEFS_LLM_PROVIDER',
          modelVars: {
            openai: 'OPENAI_BRIEF_MODEL',
            gemini: 'GEMINI_BRIEF_MODEL',
            'claude-code': 'CLAUDE_CODE_BRIEF_MODEL',
            opencode: 'OPENCODE_BRIEF_MODEL',
            cursor: 'CURSOR_BRIEF_MODEL',
          },
          job: 'brief',
        },
      ),
    ).toEqual({
      provider: 'gemini',
      apiKey: 'gem-test',
      baseURL: GEMINI_BASE_URL,
      model: 'gemini-2.5-pro',
    });
  });

  it('returns null when the selected provider has no key, even if the other does', () => {
    expect(
      loadLlmSettings(
        cfg({ LLM_PROVIDER: 'gemini', OPENAI_API_KEY: 'sk-test' }),
        {
          providerVar: 'BRIEFS_LLM_PROVIDER',
          modelVars: {
            openai: 'OPENAI_BRIEF_MODEL',
            gemini: 'GEMINI_BRIEF_MODEL',
            'claude-code': 'CLAUDE_CODE_BRIEF_MODEL',
            opencode: 'OPENCODE_BRIEF_MODEL',
            cursor: 'CURSOR_BRIEF_MODEL',
          },
          job: 'brief',
        },
      ),
    ).toBeNull();
  });
});

// The desktop translation of the source's boot-time provider choice. The
// settings screen writes `LLM_PROVIDER` and the keys into `process.env` long
// after the module graph is built, so `parse()` has to ask again every time.
describe('LiveLlmClient', () => {
  const modelVars = {
    openai: 'OPENAI_BRIEF_MODEL',
    gemini: 'GEMINI_BRIEF_MODEL',
    'claude-code': 'CLAUDE_CODE_BRIEF_MODEL',
    opencode: 'OPENCODE_BRIEF_MODEL',
    cursor: 'CURSOR_BRIEF_MODEL',
  };

  function liveClient(env: Record<string, string | undefined>): LlmClient {
    return new LiveLlmClient(() =>
      loadLlmSettings({ get: (key: string) => env[key] } as never, {
        providerVar: 'BRIEFS_LLM_PROVIDER',
        modelVars,
        job: 'brief',
      }),
    );
  }

  beforeEach(() => {
    OpenAI.__instances = [];
  });

  it('re-resolves the provider between calls, so a settings change takes effect', async () => {
    const env: Record<string, string | undefined> = {
      OPENAI_API_KEY: 'sk-test',
    };
    const client = liveClient(env);

    await client.parse(CommitAnalysisOutputSchema, 'commit_analysis', prompts);
    expect(instances()).toHaveLength(1);
    expect(instances()[0].baseURL).toBeUndefined();

    // Exactly what the AI page saves when the provider select changes.
    env.LLM_PROVIDER = 'gemini';
    env.GEMINI_API_KEY = 'gem-test';
    env.GEMINI_BRIEF_MODEL = 'gemini-2.5-pro';

    const result = await client.parse(
      CommitAnalysisOutputSchema,
      'commit_analysis',
      prompts,
    );

    expect(instances()).toHaveLength(2);
    expect(instances()[1].baseURL).toBe(GEMINI_BASE_URL);
    expect(instances()[1].chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-pro' }),
    );
    // The OpenAI client from the first call is not reused, and not called again.
    expect(instances()[0].responses.parse).toHaveBeenCalledTimes(1);
    expect(result.model).toBe('gemini-2.5-pro');
  });

  it('reuses one SDK client while the settings are unchanged', async () => {
    const client = liveClient({ OPENAI_API_KEY: 'sk-test' });
    await client.parse(CommitAnalysisOutputSchema, 'x', prompts);
    await client.parse(CommitAnalysisOutputSchema, 'x', prompts);

    expect(instances()).toHaveLength(1);
    expect(instances()[0].responses.parse).toHaveBeenCalledTimes(2);
  });

  // Boot with no key must not wedge the feature for the life of the process:
  // the stub is per call, not a provider decided once at DI time.
  it('rejects with OPENAI_NOT_CONFIGURED until a key is pasted, then serves it', async () => {
    const env: Record<string, string | undefined> = {};
    const client = liveClient(env);

    await expect(
      client.parse(CommitAnalysisOutputSchema, 'x', prompts),
    ).rejects.toMatchObject({ code: 'OPENAI_NOT_CONFIGURED' });
    expect(instances()).toHaveLength(0);

    env.OPENAI_API_KEY = 'sk-late';
    const result = await client.parse(CommitAnalysisOutputSchema, 'x', prompts);

    expect(result.model).toBe('gpt-4o-mini');
    expect(instances()).toHaveLength(1);
  });
});

// `parse()` is overridden by every client that does not talk to the OpenAI SDK
// (`LiveLlmClient`, `UnconfiguredLlmClient`, and the agent-CLI client), so the
// half of the template that is not transport — Zod validation and the result
// shape — has to be reachable on its own or each of them reinvents the error
// code and the token keys.
describe('LlmClient.validate', () => {
  class Probe extends LlmClient {
    constructor() {
      super({ provider: 'openai', apiKey: '', model: 'configured-model' });
    }

    protected request(): Promise<ProviderResponse> {
      return Promise.reject(new Error('unused'));
    }

    run<T>(schema: z.ZodType<T>, response: ProviderResponse) {
      return this.validate(schema, response);
    }
  }

  const schema = z.object({ ok: z.boolean() });

  it('returns the parsed body, the configured model and the token counts', () => {
    expect(
      new Probe().run(schema, {
        raw: { ok: true },
        promptTokens: 11,
        completionTokens: 22,
      }),
    ).toEqual({
      parsed: { ok: true },
      model: 'configured-model',
      promptTokens: 11,
      completionTokens: 22,
    });
  });

  // A CLI reports the model it actually resolved an alias to, and that is what
  // gets stored — not the alias the settings screen holds.
  it('prefers a model reported on the response over the configured one', () => {
    expect(
      new Probe().run(schema, {
        raw: { ok: true },
        model: 'claude-haiku-4-5-20251001',
        promptTokens: null,
        completionTokens: null,
      }),
    ).toMatchObject({ model: 'claude-haiku-4-5-20251001' });
  });

  it('falls back to the configured model when the response reports none', () => {
    expect(
      new Probe().run(schema, {
        raw: { ok: true },
        model: null,
        promptTokens: null,
        completionTokens: null,
      }),
    ).toMatchObject({ model: 'configured-model' });
  });

  it('raises OPENAI_RESPONSE_INVALID when the body fails the schema', () => {
    let raised: unknown;
    try {
      new Probe().run(schema, {
        raw: { ok: 'yes' },
        promptTokens: null,
        completionTokens: null,
      });
    } catch (err) {
      raised = err;
    }
    expect(raised).toMatchObject({ code: 'OPENAI_RESPONSE_INVALID' });
  });
});

describe('claude-code as a provider', () => {
  const cfg = (values: Record<string, string | undefined>) =>
    ({ get: (key: string) => values[key] }) as never;

  const opts = (job: 'commitAnalysis' | 'brief') => ({
    providerVar: 'BRIEFS_LLM_PROVIDER',
    modelVars: {
      openai: 'OPENAI_BRIEF_MODEL',
      gemini: 'GEMINI_BRIEF_MODEL',
      'claude-code': 'CLAUDE_CODE_BRIEF_MODEL',
      opencode: 'OPENCODE_BRIEF_MODEL',
      cursor: 'CURSOR_BRIEF_MODEL',
    },
    job,
  });

  // A CLI has no key to be missing, so it must never be the null that produces
  // the rejecting stub — whether the binary is there is the detector's question
  // at call time, and a config read must not spawn.
  it('resolves settings with no API key at all', () => {
    expect(
      loadLlmSettings(cfg({ LLM_PROVIDER: 'claude-code' }), opts('brief')),
    ).toEqual({ provider: 'claude-code', model: 'sonnet' });
  });

  it('splits its defaults per job: haiku for volume, sonnet for the brief', () => {
    expect(DEFAULT_MODELS['claude-code']).toEqual({
      commitAnalysis: 'haiku',
      brief: 'sonnet',
    });
    expect(
      loadLlmSettings(
        cfg({ LLM_PROVIDER: 'claude-code' }),
        opts('commitAnalysis'),
      ),
    ).toMatchObject({ model: 'haiku' });
  });

  it('keeps one value in both slots for the key providers', () => {
    expect(DEFAULT_MODELS.openai).toEqual({
      commitAnalysis: 'gpt-4o-mini',
      brief: 'gpt-4o-mini',
    });
    expect(DEFAULT_MODELS.gemini).toEqual({
      commitAnalysis: 'gemini-3.1-flash-lite',
      brief: 'gemini-3.1-flash-lite',
    });
  });

  it('honours the model override var', () => {
    expect(
      loadLlmSettings(
        cfg({
          LLM_PROVIDER: 'claude-code',
          CLAUDE_CODE_BRIEF_MODEL: 'claude-opus-4-6',
        }),
        opts('brief'),
      ),
    ).toMatchObject({ model: 'claude-opus-4-6' });
  });

  it('builds the agent CLI client from the factory', () => {
    expect(
      createLlmClient({ provider: 'claude-code', model: 'haiku' }),
    ).toBeInstanceOf(AgentCliLlmClient);
  });
});

describe('opencode as a provider', () => {
  const cfg = (values: Record<string, string | undefined>) =>
    ({ get: (key: string) => values[key] }) as never;

  // Also the source of the settings endpoint's `llmProvider` enum, which is
  // `z.enum(LLM_PROVIDERS)` rather than a repeated literal list.
  it('is selectable and needs no API key', () => {
    expect(LLM_PROVIDERS).toContain('opencode');
    expect(
      loadLlmSettings(cfg({ LLM_PROVIDER: 'opencode' }), {
        providerVar: 'BRIEFS_LLM_PROVIDER',
        modelVars: {
          openai: 'OPENAI_BRIEF_MODEL',
          gemini: 'GEMINI_BRIEF_MODEL',
          'claude-code': 'CLAUDE_CODE_BRIEF_MODEL',
          opencode: 'OPENCODE_BRIEF_MODEL',
          cursor: 'CURSOR_BRIEF_MODEL',
        },
        job: 'brief',
      }),
    ).toEqual({ provider: 'opencode', model: 'opencode/big-pickle' });
  });

  // OpenCode ids are always `provider/model`, and the default is Zen's free
  // tier for both jobs.
  it('defaults both jobs to opencode/big-pickle', () => {
    expect(DEFAULT_MODELS.opencode).toEqual({
      commitAnalysis: 'opencode/big-pickle',
      brief: 'opencode/big-pickle',
    });
  });

  it('builds the same agent CLI client from the factory', () => {
    expect(
      createLlmClient({ provider: 'opencode', model: 'opencode/big-pickle' }),
    ).toBeInstanceOf(AgentCliLlmClient);
  });
});

describe('cursor as a provider', () => {
  const cfg = (values: Record<string, string | undefined>) =>
    ({ get: (key: string) => values[key] }) as never;

  const opts = (job: 'commitAnalysis' | 'brief') => ({
    providerVar: 'BRIEFS_LLM_PROVIDER',
    modelVars: {
      openai: 'OPENAI_BRIEF_MODEL',
      gemini: 'GEMINI_BRIEF_MODEL',
      'claude-code': 'CLAUDE_CODE_BRIEF_MODEL',
      opencode: 'OPENCODE_BRIEF_MODEL',
      cursor: 'CURSOR_BRIEF_MODEL',
    },
    job,
  });

  it('is selectable and needs no API key', () => {
    expect(LLM_PROVIDERS).toContain('cursor');
    expect(
      loadLlmSettings(cfg({ LLM_PROVIDER: 'cursor' }), opts('brief')),
    ).toEqual({ provider: 'cursor', model: 'composer-2.5' });
  });

  it('splits its defaults per job', () => {
    expect(DEFAULT_MODELS.cursor).toEqual({
      commitAnalysis: 'composer-2.5-fast',
      brief: 'composer-2.5',
    });
    expect(
      loadLlmSettings(cfg({ LLM_PROVIDER: 'cursor' }), opts('commitAnalysis')),
    ).toMatchObject({ model: 'composer-2.5-fast' });
  });

  it('builds the same agent CLI client from the factory', () => {
    expect(
      createLlmClient({ provider: 'cursor', model: 'composer-2.5-fast' }),
    ).toBeInstanceOf(AgentCliLlmClient);
  });
});
