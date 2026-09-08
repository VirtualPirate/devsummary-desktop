import { z } from 'zod';

export const COMMIT_ACTIVITY_GRANULARITIES = ['day', 'week'] as const;
export type CommitActivityGranularity =
  (typeof COMMIT_ACTIVITY_GRANULARITIES)[number];

const isValidTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const CommitRangeQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  timezone: z
    .string()
    .refine(isValidTimeZone, 'Invalid IANA timezone')
    .default('UTC'),
  repositoryId: z.string().uuid().optional(),
  collaboratorId: z.string().uuid().optional(),
});

const isOrderedRange = (q: { from: string; to: string }) =>
  new Date(q.from).getTime() < new Date(q.to).getTime();

const orderedRangeIssue = {
  message: '`from` must be before `to`',
  path: ['from'],
};

export const GetCommitActivityQuerySchema = CommitRangeQuerySchema.extend({
  granularity: z.enum(COMMIT_ACTIVITY_GRANULARITIES).default('day'),
}).refine(isOrderedRange, orderedRangeIssue);

export type GetCommitActivityQuery = z.infer<
  typeof GetCommitActivityQuerySchema
>;

export const GetCommitHoursQuerySchema =
  CommitRangeQuerySchema.refine(isOrderedRange, orderedRangeIssue);

export type GetCommitHoursQuery = z.infer<typeof GetCommitHoursQuerySchema>;
