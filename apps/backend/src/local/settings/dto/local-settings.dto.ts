import { z } from 'zod';
import { AGENT_PROVIDERS, LLM_PROVIDERS } from '../../../common/llm';

/** An omitted key is left alone; an empty string clears that credential. */
export const UpdateLocalCredentialsSchema = z
  .object({
    // No `githubToken`: GitHub connects through `POST /api/integrations/github/token`,
    // which validates the PAT and writes the encrypted installation row that
    // ingest actually reads. Accepting one here only ever wrote the env mirror,
    // i.e. a `github: true` flag with nothing behind it.
    //
    // Derived from `LLM_PROVIDERS` rather than repeated, so a provider added
    // there is selectable without a second edit that is easy to forget.
    // Only the global provider is settable: the per-scope `*_LLM_PROVIDER`
    // overrides are still honoured from env, but nothing in the app writes them.
    llmProvider: z.enum(LLM_PROVIDERS),
    openaiApiKey: z.string().trim(),
    geminiApiKey: z.string().trim(),
    smtpHost: z.string().trim(),
    smtpPort: z.coerce.number().int().min(1).max(65535),
    smtpUser: z.string().trim(),
    smtpPass: z.string(),
    emailFrom: z.string().trim(),
    slackBotToken: z.string().trim(),
    desktopNotifications: z.boolean(),
    commitAnalysisModel: z.string().trim().max(100),
    briefModel: z.string().trim().max(100),
  })
  .partial();

export type UpdateLocalCredentialsBody = z.infer<
  typeof UpdateLocalCredentialsSchema
>;

export const TestEmailSchema = z.object({
  to: z.string().email(),
});

export type TestEmailBody = z.infer<typeof TestEmailSchema>;

/** `?refresh=1` bypasses the detector's 60 s cache — the card's Refresh button.
 *  Anything else is simply not a refresh, rather than a 400: a query param the
 *  page did not mean is not worth failing a read over. */
export const AgentCliQuerySchema = z.object({
  refresh: z.string().optional(),
});

export type AgentCliQuery = z.infer<typeof AgentCliQuerySchema>;

export const AgentCliParamSchema = z.object({
  id: z.enum(AGENT_PROVIDERS),
});

export type AgentCliParam = z.infer<typeof AgentCliParamSchema>;
