import { z } from 'zod';

export const ScheduleIdParamSchema = z.object({ id: z.string().uuid() });
export type ScheduleIdParam = z.infer<typeof ScheduleIdParamSchema>;
