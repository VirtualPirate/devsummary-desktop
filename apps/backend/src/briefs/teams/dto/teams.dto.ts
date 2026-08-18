import { z } from 'zod';

export const TeamIdParamSchema = z.object({ teamId: z.string().uuid() });
export type TeamIdParam = z.infer<typeof TeamIdParamSchema>;
