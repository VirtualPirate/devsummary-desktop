import type { ConfigService } from '@nestjs/config';

export const MAX_DIFF_CHARS = 60_000;
export const TEAM_SIZE = 4;
export const TEAM_CONCURRENCY = 2;

export interface CommitAnalysisConfig {
  apiKey: string;
  model: string;
  maxDiffChars: number;
  teamSize: number;
  teamConcurrency: number;
}

export function loadCommitAnalysisConfig(
  configService: ConfigService,
): CommitAnalysisConfig | null {
  const apiKey = configService.get<string>('OPENAI_API_KEY');
  if (!apiKey) return null;

  return {
    apiKey,
    model:
      configService.get<string>('OPENAI_COMMIT_ANALYSIS_MODEL') ||
      'gpt-4o-mini',
    maxDiffChars: MAX_DIFF_CHARS,
    teamSize: TEAM_SIZE,
    teamConcurrency: TEAM_CONCURRENCY,
  };
}
