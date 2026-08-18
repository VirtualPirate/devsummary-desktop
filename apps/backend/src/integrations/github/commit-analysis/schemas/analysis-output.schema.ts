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
