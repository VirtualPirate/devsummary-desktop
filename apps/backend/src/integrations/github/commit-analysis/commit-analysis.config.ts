import type { ConfigService } from '@nestjs/config';

export const MAX_DIFF_CHARS = 60_000;
export const TEAM_SIZE = 4;
export const TEAM_CONCURRENCY = 2;
export const DEFAULT_COMMIT_ANALYSIS_MODEL = 'gpt-4o-mini';

export interface CommitAnalysisConfig {
  apiKey: string;
  model: string;
  maxDiffChars: number;
  teamSize: number;
  teamConcurrency: number;
}

/**
 * `apiKey` and `model` are **getters**, not values read once at boot.
 *
 * On a desktop install the key and the model override arrive from the settings
 * screen long after the module graph is built (`SecretsService.update` writes
 * them to `process.env`, which `ConfigService.get` falls through to). A
 * snapshot here meant a pasted key did nothing until the app was relaunched,
 * and a boot with no key wedged the whole feature behind a stub for the life of
 * the process. An empty `apiKey` is the "not configured" signal now, checked by
 * `OpenAIClient` at call time.
 */
export function loadCommitAnalysisConfig(
  configService: ConfigService,
): CommitAnalysisConfig {
  return {
    get apiKey(): string {
      return configService.get<string>('OPENAI_API_KEY') ?? '';
    },
    get model(): string {
      return (
        configService.get<string>('OPENAI_COMMIT_ANALYSIS_MODEL') ||
        DEFAULT_COMMIT_ANALYSIS_MODEL
      );
    },
    maxDiffChars: MAX_DIFF_CHARS,
    teamSize: TEAM_SIZE,
    teamConcurrency: TEAM_CONCURRENCY,
  };
}
