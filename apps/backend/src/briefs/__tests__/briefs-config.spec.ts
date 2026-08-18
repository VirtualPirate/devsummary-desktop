import {
  loadBriefsConfig,
  DEFAULT_BACKFILL_MAX_BRIEFS,
} from '../briefs-config';

function makeConfig(map: Record<string, string | undefined>) {
  return { get: (k: string) => map[k] } as any;
}

describe('loadBriefsConfig backfillMaxBriefs', () => {
  it('returns null when OPENAI_API_KEY is absent', () => {
    expect(loadBriefsConfig(makeConfig({}))).toBeNull();
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
