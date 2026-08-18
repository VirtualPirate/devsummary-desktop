import { z } from 'zod';

/** An omitted key is left alone; an empty string clears that credential. */
export const UpdateLocalCredentialsSchema = z
  .object({
    // No `githubToken`: GitHub connects through `POST /api/integrations/github/token`,
    // which validates the PAT and writes the encrypted installation row that
    // ingest actually reads. Accepting one here only ever wrote the env mirror,
    // i.e. a `github: true` flag with nothing behind it.
    openaiApiKey: z.string().trim(),
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
