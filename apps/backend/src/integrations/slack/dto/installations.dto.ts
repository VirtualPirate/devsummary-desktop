import { z } from 'zod';

export const CallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

export type CallbackQuery = z.infer<typeof CallbackQuerySchema>;

export const InstallationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const PostMessageBodySchema = z.object({
  channelId: z.string().min(1),
  text: z.string().min(1),
});

export type PostMessageBody = z.infer<typeof PostMessageBodySchema>;

export const ChannelIdParamSchema = z.object({
  channelId: z.string().min(1),
});
