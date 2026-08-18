import {
  CommitAnalysisOutputSchema,
  CommitTypeSchema,
} from '../schemas/analysis-output.schema';

describe('CommitTypeSchema', () => {
  it.each([
    'fix',
    'feature',
    'optimization',
    'refactor',
    'docs',
    'test',
    'chore',
  ])('accepts %s', (val) => {
    expect(CommitTypeSchema.parse(val)).toBe(val);
  });

  it('rejects unknown tags', () => {
    expect(CommitTypeSchema.safeParse('wip').success).toBe(false);
  });
});

describe('CommitAnalysisOutputSchema', () => {
  it('accepts a valid payload', () => {
    const out = CommitAnalysisOutputSchema.parse({
      commit_type: 'fix',
      summary: 'Repair the foo',
      changes: ['Replaced bar with baz'],
    });
    expect(out.commit_type).toBe('fix');
  });

  it('rejects empty changes array', () => {
    expect(
      CommitAnalysisOutputSchema.safeParse({
        commit_type: 'fix',
        summary: 'x',
        changes: [],
      }).success,
    ).toBe(false);
  });

  it('rejects too-long summary', () => {
    expect(
      CommitAnalysisOutputSchema.safeParse({
        commit_type: 'fix',
        summary: 'x'.repeat(201),
        changes: ['ok'],
      }).success,
    ).toBe(false);
  });

  it('rejects more than 8 changes', () => {
    expect(
      CommitAnalysisOutputSchema.safeParse({
        commit_type: 'fix',
        summary: 'x',
        changes: Array.from({ length: 9 }, (_, i) => `c${i}`),
      }).success,
    ).toBe(false);
  });
});
