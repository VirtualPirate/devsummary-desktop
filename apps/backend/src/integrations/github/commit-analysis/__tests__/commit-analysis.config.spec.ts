import { loadCommitAnalysisConfig } from '../commit-analysis.config';

function makeConfig(values: Record<string, string | undefined>) {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  };
}

describe('loadCommitAnalysisConfig', () => {
  it('returns null when OPENAI_API_KEY is missing', () => {
    expect(loadCommitAnalysisConfig(makeConfig({}) as never)).toBeNull();
  });

  it('returns config with hardcoded tunables when only OPENAI_API_KEY is set', () => {
    const cfg = loadCommitAnalysisConfig(
      makeConfig({ OPENAI_API_KEY: 'sk-test' }) as never,
    );
    expect(cfg).toEqual({
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      maxDiffChars: 60000,
      teamSize: 4,
      teamConcurrency: 2,
    });
  });

  it('uses OPENAI_COMMIT_ANALYSIS_MODEL when set', () => {
    const cfg = loadCommitAnalysisConfig(
      makeConfig({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_COMMIT_ANALYSIS_MODEL: 'gpt-4.1',
      }) as never,
    );
    expect(cfg).toMatchObject({
      apiKey: 'sk-test',
      model: 'gpt-4.1',
    });
  });
});
