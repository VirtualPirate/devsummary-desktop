import { z } from 'zod';

const BigIntString = z.string().regex(/^[0-9]+$/, 'must be a numeric string');

export const CallbackQuerySchema = z.object({
  installation_id: BigIntString,
  setup_action: z.enum(['install', 'update']),
  state: z.string().min(1).optional(),
});

export type CallbackQuery = z.infer<typeof CallbackQuerySchema>;

export const InstallationIdParamSchema = z.object({
  id: z.string().uuid(),
});
