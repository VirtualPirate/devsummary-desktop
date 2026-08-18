import { z } from 'zod';

export const BriefIdParamSchema = z.object({ briefId: z.string().uuid() });
export type BriefIdParam = z.infer<typeof BriefIdParamSchema>;
