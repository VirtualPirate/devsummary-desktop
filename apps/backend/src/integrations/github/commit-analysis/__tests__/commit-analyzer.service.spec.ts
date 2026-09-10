import {
  COMMITS_PER_CALL,
  CommitAnalyzerService,
  filterFiles,
  packDiff,
  type BatchAnalyzeInput,
} from '../services/commit-analyzer.service';
import type { LlmClient } from '../../../../common/llm';
import type { CommitAnalysisConfig } from '../commit-analysis.config';

function file(
  path: string,
  overrides: {
    patch?: string | null;
    additions?: number;
    deletions?: number;
  } = {},
) {
  return {
    path,
    additions: overrides.additions ?? 1,
    deletions: overrides.deletions ?? 0,
    patch: overrides.patch === undefined ? '@@ patch @@' : overrides.patch,
  };
}

describe('NOISE_PATTERNS', () => {
  it.each([
    ['pnpm-lock.yaml'],
    ['apps/foo/dist/bundle.js'],
    ['src/foo/__generated__/x.ts'],
    ['vendor/lib.go'],
    ['assets/logo.png'],
    ['public/app.min.js'],
  ])('matches %s as noise', (path) => {
    expect(filterFiles([file(path)])).toEqual([]);
  });

  it.each([['src/foo.ts'], ['README.md'], ['apps/backend/src/main.ts']])(
    'keeps %s',
    (path) => {
      expect(filterFiles([file(path)])).toHaveLength(1);
    },
  );
});

describe('packDiff', () => {
  it('returns all patches verbatim under budget', () => {
    const { sections, truncated, charsSent } = packDiff(
      [file('a.ts', { patch: 'small-a' }), file('b.ts', { patch: 'small-b' })],
      1000,
    );
    expect(truncated).toBe(false);
    expect(charsSent).toBe('small-a'.length + 'small-b'.length);
    expect(sections.join('\n')).toMatch(/a\.ts[\s\S]+small-a/);
  });

  it('falls back to summary lines for files that exceed the budget', () => {
    const { sections, truncated } = packDiff(
      [
        file('small.ts', { patch: 'small-patch' }),
        file('huge.ts', {
          patch: 'x'.repeat(50),
          additions: 100,
          deletions: 50,
        }),
      ],
      20,
    );
    expect(truncated).toBe(true);
    expect(sections.some((s) => s.includes('small.ts'))).toBe(true);
    expect(sections.some((s) => s.includes('(truncated)'))).toBe(true);
  });
});

describe('CommitAnalyzerService.buildPrompt', () => {
  it('produces a prompt with delimiters and file list', () => {
    const svc = new CommitAnalyzerService(
      { parse: jest.fn() } as never,
      { maxDiffChars: 1000 } as never,
    );
    const prompt = svc.buildUserPrompt({
      repoFullName: 'acme/api',
      authorName: 'A',
      authorEmail: 'a@x',
      message: 'feat: do thing',
      files: [file('src/x.ts', { patch: 'xy' })],
      truncated: false,
    });
    expect(prompt).toMatch(/<commit_message>/);
    expect(prompt).toMatch(/<diff>/);
    expect(prompt).toMatch(/src\/x\.ts\s+\+1\/-0/);
  });
});

describe('CommitAnalyzerService.analyzeCommit', () => {
  it('returns skipped_empty when no files survive the filter', async () => {
    const ai = { parse: jest.fn() };
    const svc = new CommitAnalyzerService(
      ai as never,
      { maxDiffChars: 1000 } as never,
    );

    const result = await svc.analyzeCommit({
      repoFullName: 'acme/api',
      authorName: 'A',
      authorEmail: 'a@x',
      message: 'm',
      files: [file('pnpm-lock.yaml', { patch: 'patch' })],
    });

    expect(result.status).toBe('skipped_empty');
    expect(ai.parse).not.toHaveBeenCalled();
  });

  it('calls the LLM and returns analyzed status on success', async () => {
    const ai = {
      parse: jest.fn(async () => ({
        parsed: {
          commit_type: 'fix',
          summary: 's',
          changes: ['c1'],
        },
        // The answering model, which is what the analysis row stores now that
        // the config no longer carries one.
        model: 'gpt-4o-mini',
        promptTokens: 10,
        completionTokens: 20,
      })),
    };
    const svc = new CommitAnalyzerService(
      ai as never,
      { maxDiffChars: 1000 } as never,
    );

    const result = await svc.analyzeCommit({
      repoFullName: 'acme/api',
      authorName: 'A',
      authorEmail: 'a@x',
      message: 'm',
      files: [file('src/x.ts', { patch: 'p' })],
    });

    expect(result.status).toBe('analyzed');
    expect((result as any).commitType).toBe('fix');
    expect((result as any).promptTokens).toBe(10);
    expect((result as any).model).toBe('gpt-4o-mini');
    expect(ai.parse).toHaveBeenCalled();
  });
});

describe('CommitAnalyzerService.analyzeCommits', () => {
  const commit = (sha: string, over: Partial<BatchAnalyzeInput> = {}) => ({
    sha,
    repoFullName: 'acme/web',
    authorName: 'A',
    authorEmail: 'a@b.c',
    message: `work on ${sha}`,
    files: [file(`src/${sha}.ts`, { patch: `@@ ${sha} @@` })],
    ...over,
  });

  const entry = (sha: string) => ({
    sha,
    commit_type: 'feature' as const,
    summary: `did ${sha}`,
    changes: [`changed ${sha}`],
  });

  /** `llm` is the DI token, so the double only has to answer `parse`. */
  const makeService = (
    parse: jest.Mock,
    config: Partial<CommitAnalysisConfig> = {},
  ) =>
    new CommitAnalyzerService({ parse } as unknown as LlmClient, {
      llm: { provider: 'claude-code', model: 'haiku' },
      maxDiffChars: 60_000,
      teamSize: 4,
      teamConcurrency: 2,
      ...config,
    });

  /**
   * The three `parse` params, declared. `jest.fn(async () => …)` types
   * `mock.calls` as an empty tuple, so a test that reads the prompt back off
   * it does not compile — and the cast that hides that is what the batch
   * tests are here to avoid.
   */
  const parseMock = (
    parsed: unknown,
    promptTokens = 10,
    completionTokens = 10,
  ) =>
    jest.fn(
      async (
        _schema: unknown,
        _schemaName: string,
        _args: { systemPrompt: string; userPrompt: string },
      ) => ({ parsed, model: 'haiku', promptTokens, completionTokens }),
    );

  it('answers every commit from one call, keyed by sha', async () => {
    const parse = parseMock(
      { analyses: [entry('aaaaaaa'), entry('bbbbbbb')] },
      1000,
      400,
    );

    const out = await makeService(parse).analyzeCommits([
      commit('aaaaaaa'),
      commit('bbbbbbb'),
    ]);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(out.get('aaaaaaa')).toMatchObject({
      status: 'analyzed',
      summary: 'did aaaaaaa',
      // One call's tokens, divided by what it answered — the columns are per
      // commit, so the whole total on each row would report double.
      promptTokens: 500,
      completionTokens: 200,
    });
    expect(out.get('bbbbbbb')).toMatchObject({ summary: 'did bbbbbbb' });

    // Each commit's diff arrives in its own sha-labelled block.
    const { userPrompt } = parse.mock.calls[0][2];
    expect(userPrompt).toContain('<commit sha="aaaaaaa">');
    expect(userPrompt).toContain('<commit sha="bbbbbbb">');
  });

  // Absent, not guessed: the caller re-analyses it alone. Attaching an
  // unrequested sha's summary to a row would be worse than a second call.
  it('leaves a commit the model did not answer out of the map', async () => {
    const parse = parseMock({ analyses: [entry('aaaaaaa'), entry('deadbee')] });

    const out = await makeService(parse).analyzeCommits([
      commit('aaaaaaa'),
      commit('bbbbbbb'),
    ]);

    expect(out.has('aaaaaaa')).toBe(true);
    expect(out.has('bbbbbbb')).toBe(false);
    expect(out.has('deadbee')).toBe(false);
  });

  it('resolves an all-noise commit without spending a call on it', async () => {
    const parse = parseMock({ analyses: [entry('aaaaaaa')] });

    const out = await makeService(parse).analyzeCommits([
      commit('aaaaaaa'),
      commit('bbbbbbb', { files: [file('pnpm-lock.yaml')] }),
    ]);

    expect(out.get('bbbbbbb')).toEqual({ status: 'skipped_empty' });
    const { userPrompt } = parse.mock.calls[0][2];
    expect(userPrompt).not.toContain('bbbbbbb');
  });

  it('uses the single-commit prompt when there is only one commit', async () => {
    const parse = parseMock(entry('aaaaaaa'));

    const out = await makeService(parse).analyzeCommits([commit('aaaaaaa')]);

    expect(parse.mock.calls[0][1]).toBe('commit_analysis');
    expect(out.get('aaaaaaa')).toMatchObject({ status: 'analyzed' });
  });

  // The budget is per call, not per commit: four commits at the single-commit
  // cap would be a 240k-char prompt.
  it('splits the diff budget across the batch', async () => {
    const parse = parseMock({
      analyses: [entry('aaaaaaa'), entry('bbbbbbb')],
    });
    const big = (sha: string) =>
      commit(sha, {
        files: [file(`src/${sha}.ts`, { patch: '@@'.padEnd(400, 'x') })],
      });

    await makeService(parse, { maxDiffChars: 500 }).analyzeCommits([
      big('aaaaaaa'),
      big('bbbbbbb'),
    ]);

    const { userPrompt } = parse.mock.calls[0][2];
    expect(userPrompt).toContain('(truncated)');
  });

  it('packs one commit per call for a keyed provider and four for a CLI', () => {
    const parse = jest.fn();
    expect(
      makeService(parse, {
        llm: { provider: 'openai', apiKey: 'k', model: 'm' },
      }).commitsPerCall,
    ).toBe(1);
    expect(makeService(parse).commitsPerCall).toBe(COMMITS_PER_CALL);
    expect(makeService(parse, { llm: null }).commitsPerCall).toBe(1);
  });
});
