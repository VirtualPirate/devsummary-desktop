import { loadCommitAnalysisConfig } from '../commit-analysis.config';

function makeConfig(values: Record<string, string | undefined>) {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  };
}

describe('loadCommitAnalysisConfig', () => {
  it('reports a null llm when no provider key is set', () => {
    expect(loadCommitAnalysisConfig(makeConfig({}) as never).llm).toBeNull();
  });

  it('resolves llm live, so a key pasted after boot takes effect', () => {
    const values: Record<string, string | undefined> = {};
    const cfg = loadCommitAnalysisConfig(makeConfig(values) as never);
    expect(cfg.llm).toBeNull();

    values.OPENAI_API_KEY = 'sk-late';
    values.OPENAI_COMMIT_ANALYSIS_MODEL = 'gpt-4.1';
    expect(cfg.llm).toEqual({
      provider: 'openai',
      apiKey: 'sk-late',
      baseURL: undefined,
      model: 'gpt-4.1',
    });
  });

  it('returns config with hardcoded tunables when only OPENAI_API_KEY is set', () => {
    const cfg = loadCommitAnalysisConfig(
      makeConfig({ OPENAI_API_KEY: 'sk-test' }) as never,
    );
    expect(cfg).toEqual({
      llm: {
        provider: 'openai',
        apiKey: 'sk-test',
        baseURL: undefined,
        model: 'gpt-4o-mini',
      },
      maxDiffChars: 60000,
      teamSize: 4,
      teamConcurrency: 2,
    });
  });

  // The per-scope provider var is honoured from env exactly as in the webapp,
  // even though the settings screen only ever writes the global `LLM_PROVIDER`.
  it('reads the gemini key and model when the scope var selects gemini', () => {
    const cfg = loadCommitAnalysisConfig(
      makeConfig({
        OPENAI_API_KEY: 'sk-test',
        GEMINI_API_KEY: 'gem-test',
        COMMIT_ANALYSIS_LLM_PROVIDER: 'gemini',
        GEMINI_COMMIT_ANALYSIS_MODEL: 'gemini-2.5-pro',
      }) as never,
    );
    expect(cfg.llm).toMatchObject({
      provider: 'gemini',
      apiKey: 'gem-test',
      model: 'gemini-2.5-pro',
    });
  });
});
