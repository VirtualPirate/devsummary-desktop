import type { ConfigService } from '@nestjs/config';
import {
  loadBriefsConfig,
  DEFAULT_BACKFILL_MAX_BRIEFS,
} from '../briefs-config';

function makeConfig(map: Record<string, string | undefined>): ConfigService {
  return { get: (k: string) => map[k] } as unknown as ConfigService;
}

describe('loadBriefsConfig backfillMaxBriefs', () => {
  it('reports a null llm when no provider key is set', () => {
    expect(loadBriefsConfig(makeConfig({})).llm).toBeNull();
  });

  it('resolves llm live, so a key pasted after boot takes effect', () => {
    const env: Record<string, string | undefined> = {};
    const cfg = loadBriefsConfig(makeConfig(env));
    expect(cfg.llm).toBeNull();

    env.OPENAI_API_KEY = 'sk-late';
    env.OPENAI_BRIEF_MODEL = 'gpt-4.1';
    expect(cfg.llm).toMatchObject({
      provider: 'openai',
      apiKey: 'sk-late',
      model: 'gpt-4.1',
    });
  });

  it('defaults backfillMaxBriefs when env is unset', () => {
    const cfg = loadBriefsConfig(makeConfig({ OPENAI_API_KEY: 'k' }));
    expect(cfg?.backfillMaxBriefs).toBe(DEFAULT_BACKFILL_MAX_BRIEFS);
  });

  it('parses a positive BRIEFS_BACKFILL_MAX_BRIEFS override', () => {
    const cfg = loadBriefsConfig(
      makeConfig({ OPENAI_API_KEY: 'k', BRIEFS_BACKFILL_MAX_BRIEFS: '50' }),
    );
    expect(cfg?.backfillMaxBriefs).toBe(50);
  });

  it('falls back to default for a non-positive override', () => {
    const cfg = loadBriefsConfig(
      makeConfig({ OPENAI_API_KEY: 'k', BRIEFS_BACKFILL_MAX_BRIEFS: '0' }),
    );
    expect(cfg?.backfillMaxBriefs).toBe(DEFAULT_BACKFILL_MAX_BRIEFS);
  });
});
