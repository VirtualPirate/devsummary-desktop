import { z } from 'zod';

/**
 * Bot tokens are `xoxb-…`. The prefix is checked here rather than left to
 * `auth.test` so a pasted *user* token (`xoxp-`) or app-level token (`xapp-`)
 * fails with something the settings screen can explain — all three
 * authenticate, only one can `chat.postMessage` as the bot.
 */
export const ConnectTokenBodySchema = z.object({
  token: z
    .string()
    .trim()
    .min(1)
    .refine((t) => t.startsWith('xoxb-'), {
      message: 'Expected a bot token starting with "xoxb-"',
    }),
});

export type ConnectTokenBody = z.infer<typeof ConnectTokenBodySchema>;

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
