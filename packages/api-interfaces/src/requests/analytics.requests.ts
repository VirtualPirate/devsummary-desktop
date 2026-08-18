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

export const GetCommitActivityQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    granularity: z.enum(COMMIT_ACTIVITY_GRANULARITIES).default('day'),
    timezone: z
      .string()
      .refine(isValidTimeZone, 'Invalid IANA timezone')
      .default('UTC'),
    repositoryId: z.string().uuid().optional(),
    collaboratorId: z.string().uuid().optional(),
  })
  .refine((q) => new Date(q.from).getTime() < new Date(q.to).getTime(), {
    message: '`from` must be before `to`',
    path: ['from'],
  });

export type GetCommitActivityQuery = z.infer<
  typeof GetCommitActivityQuerySchema
>;
