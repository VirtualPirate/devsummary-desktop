import { z } from 'zod';

/**
 * Shape only — GitHub is the real validator, and fine-grained tokens have
 * changed prefix before. The max is a payload guard, not a format rule.
 */
export const ConnectTokenBodySchema = z.object({
  token: z.string().trim().min(1).max(500),
});

export type ConnectTokenBody = z.infer<typeof ConnectTokenBodySchema>;

export const InstallationIdParamSchema = z.object({
  id: z.string().uuid(),
});
