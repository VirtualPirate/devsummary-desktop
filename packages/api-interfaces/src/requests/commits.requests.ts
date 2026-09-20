import { z } from 'zod';
import { BRIEF_COMMIT_TYPES } from '../responses/briefs.responses';

/**
 * The org-wide commit explorer's filter set. The window is **half-open** and
 * carries no timezone: the client resolves both calendar dates into instants in
 * the viewer's zone, so nothing here ever reaches SQL as a zone name.
 */
export const ListCommitsQuerySchema = z.object({
  /** Inclusive instant. */
  from: z.string().datetime().optional(),
  /** EXCLUSIVE instant — the midnight after the last day the user picked. */
  to: z.string().datetime().optional(),
  /** `unclassified` means "no analysed analysis", matching `commitTypeCounts`. */
  commitType: z.enum(BRIEF_COMMIT_TYPES).optional(),
  repositoryId: z.string().uuid().optional(),
  analyzedOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ListCommitsQuery = z.infer<typeof ListCommitsQuerySchema>;
