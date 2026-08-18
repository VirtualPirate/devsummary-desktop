import { MAX_HISTORY_DAYS } from '@launchstack/api-interfaces';
import { z } from 'zod';

export const RepositoryIdParamSchema = z.object({
  repoId: z.string().uuid(),
});

export const BackfillBodySchema = z.object({
  /**
   * How far back to fetch from GitHub. Capped at the product ceiling: this is
   * the one endpoint that can pull unbounded history on demand, and every
   * commit it pulls is an OpenAI call the caller never priced.
   */
  days: z.number().int().min(1).max(MAX_HISTORY_DAYS).optional(),
  /** Omitted = every branch the repository is tracked on. */
  branch: z.string().min(1).max(255).optional(),
});

export type BackfillBody = z.infer<typeof BackfillBodySchema>;

export const AnalyzeBodySchema = z.object({
  days: z.number().int().min(1),
  force: z.boolean().optional(),
});

export type AnalyzeBody = z.infer<typeof AnalyzeBodySchema>;
