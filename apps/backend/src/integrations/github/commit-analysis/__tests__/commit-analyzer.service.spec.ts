import {
  CommitAnalyzerService,
  NOISE_PATTERNS,
  filterFiles,
  packDiff,
} from '../services/commit-analyzer.service';

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
      { analyze: jest.fn() } as never,
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
    const ai = { analyze: jest.fn() };
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
    expect(ai.analyze).not.toHaveBeenCalled();
  });

  it('calls openai and returns analyzed status on success', async () => {
    const ai = {
      analyze: jest.fn(async () => ({
        parsed: {
          commit_type: 'fix',
          summary: 's',
          changes: ['c1'],
        },
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
    expect(ai.analyze).toHaveBeenCalled();
  });
});
