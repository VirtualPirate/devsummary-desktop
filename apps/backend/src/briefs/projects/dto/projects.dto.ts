import { z } from 'zod';

export const ProjectIdParamSchema = z.object({
  projectId: z.string().uuid(),
});
export type ProjectIdParam = z.infer<typeof ProjectIdParamSchema>;
