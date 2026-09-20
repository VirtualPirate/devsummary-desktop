import type { ConfigService } from '@nestjs/config';
import { AGENT_MODEL_VARS, loadAgentsConfig } from '../agents.config';
import {
  DEFAULT_MODELS,
  GEMINI_BASE_URL,
  LLM_PROVIDERS,
} from '../../common/llm';

function makeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (k: string) => values[k],
  } as unknown as ConfigService;
}

describe('loadAgentsConfig', () => {
  const full = { OPENAI_API_KEY: 'sk-test' };

  it('names an env var for every provider, so a new one cannot be half-added', () => {
    expect(Object.keys(AGENT_MODEL_VARS).sort()).toEqual(
      [...LLM_PROVIDERS].sort(),
    );
  });

  it('returns null llm when the selected provider has no API key', () => {
    expect(loadAgentsConfig(makeConfig({})).llm).toBeNull();
  });

  it('applies the provider default when no override is set', () => {
    expect(loadAgentsConfig(makeConfig(full)).llm).toMatchObject({
      provider: 'openai',
      apiKey: 'sk-test',
      baseURL: undefined,
      model: DEFAULT_MODELS.openai.agent,
    });
  });

  // The whole reason the config is a getter: the AI settings page writes
  // `LLM_PROVIDER` and the keys into `process.env` mid-session, and a snapshot
  // taken when the module graph was built would need a relaunch to notice.
  it('re-reads the environment on every access', () => {
    const values: Record<string, string | undefined> = { ...full };
    const config = loadAgentsConfig(makeConfig(values));
    expect(config.llm?.provider).toBe('openai');

    values.LLM_PROVIDER = 'gemini';
    values.GEMINI_API_KEY = 'g-test';
    expect(config.llm).toMatchObject({
      provider: 'gemini',
      apiKey: 'g-test',
      baseURL: GEMINI_BASE_URL,
      model: DEFAULT_MODELS.gemini.agent,
    });
  });

  it('follows the global LLM_PROVIDER, and lets AGENTS_LLM_PROVIDER override it', () => {
    expect(
      loadAgentsConfig(
        makeConfig({
          ...full,
          LLM_PROVIDER: 'gemini',
          AGENTS_LLM_PROVIDER: 'openai',
          GEMINI_API_KEY: 'g-test',
        }),
      ).llm,
    ).toMatchObject({ provider: 'openai', apiKey: 'sk-test' });
  });

  it('takes the per-provider model override', () => {
    expect(
      loadAgentsConfig(makeConfig({ ...full, OPENAI_AGENT_MODEL: 'gpt-4.1' }))
        .llm?.model,
    ).toBe('gpt-4.1');
    expect(
      loadAgentsConfig(
        makeConfig({
          ...full,
          AGENTS_LLM_PROVIDER: 'gemini',
          GEMINI_API_KEY: 'g-test',
          GEMINI_AGENT_MODEL: 'gemini-3.6-pro',
        }),
      ).llm?.model,
    ).toBe('gemini-3.6-pro');
  });

  // An agent CLI has no key to be missing, so it is never the null that means
  // "not configured" — whether the binary is there is answered at call time.
  it('resolves a CLI provider with no key at all', () => {
    expect(
      loadAgentsConfig(makeConfig({ LLM_PROVIDER: 'claude-code' })).llm,
    ).toEqual({
      provider: 'claude-code',
      model: DEFAULT_MODELS['claude-code'].agent,
    });
  });

  it('rejects an unknown provider rather than falling back to openai', () => {
    expect(
      () =>
        loadAgentsConfig(makeConfig({ ...full, AGENTS_LLM_PROVIDER: 'gemeni' }))
          .llm,
    ).toThrow(/AGENTS_LLM_PROVIDER/);
  });
});
