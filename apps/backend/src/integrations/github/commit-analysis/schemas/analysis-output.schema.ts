import { z } from 'zod';

export const CommitTypeSchema = z.enum([
  'fix',
  'feature',
  'optimization',
  'refactor',
  'docs',
  'test',
  'chore',
]);

export type CommitType = z.infer<typeof CommitTypeSchema>;

export const CommitAnalysisOutputSchema = z.object({
  commit_type: CommitTypeSchema,
  summary: z.string().min(1).max(200),
  changes: z.array(z.string().min(1).max(280)).min(1).max(8),
});

export type CommitAnalysisOutput = z.infer<typeof CommitAnalysisOutputSchema>;

/**
 * Several commits answered by one call, each keyed by the sha it was given.
 *
 * `extend`ed from the single-commit schema rather than restated: the two are
 * the same contract, and a second copy would drift the day a field is added —
 * with nothing failing to compile, because the model is what reads it.
 */
export const CommitAnalysisBatchOutputSchema = z.object({
  analyses: z
    .array(
      CommitAnalysisOutputSchema.extend({ sha: z.string().min(7).max(64) }),
    )
    .min(1),
});

export type CommitAnalysisBatchOutput = z.infer<
  typeof CommitAnalysisBatchOutputSchema
>;
