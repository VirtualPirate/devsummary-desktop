import type { ConfigService } from '@nestjs/config';
import {
  loadLlmSettings,
  type LlmProvider,
  type LlmSettings,
} from '../../../common/llm';

export const MAX_DIFF_CHARS = 60_000;
export const TEAM_SIZE = 4;
export const TEAM_CONCURRENCY = 2;
/** The analysis model override per provider. Also read by the settings screen. */
export const COMMIT_ANALYSIS_MODEL_VARS = {
  openai: 'OPENAI_COMMIT_ANALYSIS_MODEL',
  gemini: 'GEMINI_COMMIT_ANALYSIS_MODEL',
  'claude-code': 'CLAUDE_CODE_COMMIT_ANALYSIS_MODEL',
  opencode: 'OPENCODE_COMMIT_ANALYSIS_MODEL',
} as const satisfies Record<LlmProvider, string>;

export interface CommitAnalysisConfig {
  /**
   * The provider, key and model to use **right now**, or null when the selected
   * provider has no key yet. A getter, not a value — see the note below.
   */
  readonly llm: LlmSettings | null;
  maxDiffChars: number;
  teamSize: number;
  teamConcurrency: number;
}

/**
 * `llm` is a **getter**, not a value read once at boot.
 *
 * On a desktop install the provider, the key and the model override arrive from
 * the settings screen long after the module graph is built
 * (`SecretsService.update` writes them to `process.env`, which
 * `ConfigService.get` falls through to). A snapshot here meant a pasted key did
 * nothing until the app was relaunched, and a boot with no key wedged the whole
 * feature behind a stub for the life of the process. A null `llm` is the "not
 * configured" signal now; `LiveLlmClient` re-reads it on every call and turns
 * it into the rejecting `UnconfiguredLlmClient`.
 */
export function loadCommitAnalysisConfig(
  configService: ConfigService,
): CommitAnalysisConfig {
  return {
    get llm(): LlmSettings | null {
      return loadLlmSettings(configService, {
        providerVar: 'COMMIT_ANALYSIS_LLM_PROVIDER',
        modelVars: COMMIT_ANALYSIS_MODEL_VARS,
        job: 'commitAnalysis',
      });
    },
    maxDiffChars: MAX_DIFF_CHARS,
    teamSize: TEAM_SIZE,
    teamConcurrency: TEAM_CONCURRENCY,
  };
}
