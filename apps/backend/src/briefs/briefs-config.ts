import type { ConfigService } from '@nestjs/config';
import {
  loadLlmSettings,
  type LlmProvider,
  type LlmSettings,
} from '../common/llm';

export const DEFAULT_MAX_PROMPT_CHARS = 30_000;
export const DEFAULT_DISPATCHER_INTERVAL_SECONDS = 60;
/** The brief model override per provider. Also read by the settings screen. */
export const BRIEF_MODEL_VARS = {
  openai: 'OPENAI_BRIEF_MODEL',
  gemini: 'GEMINI_BRIEF_MODEL',
  'claude-code': 'CLAUDE_CODE_BRIEF_MODEL',
  opencode: 'OPENCODE_BRIEF_MODEL',
  cursor: 'CURSOR_BRIEF_MODEL',
} as const satisfies Record<LlmProvider, string>;
/**
 * Fan-out cap on backfilled briefs per schedule. `MAX_HISTORY_DAYS` is the
 * binding limit in practice (90 days of daily briefs is ~91), so this is the
 * belt to that suspenders: it still holds if a future cadence slices the same
 * window finer.
 */
export const DEFAULT_BACKFILL_MAX_BRIEFS = 100;
/**
 * Months of history backfilled when a create request omits `backfillMonths`.
 * Three months is also the ceiling — `MAX_HISTORY_DAYS` bounds the resolved
 * window regardless, and nothing older than that was ingested to summarize.
 */
export const DEFAULT_BACKFILL_MONTHS = 3;
export const DEFAULT_MAX_SCHEDULES_PER_ORG = 20;

/**
 * Read on its own rather than off `BriefsConfig`: the cap bounds backfill fan-out
 * (each schedule can spawn up to `BRIEFS_BACKFILL_MAX_BRIEFS` briefs), so it must
 * still apply when no provider key is set at all.
 */
export function loadMaxSchedulesPerOrg(config: ConfigService): number {
  const parsed = Number.parseInt(
    config.get<string>('BRIEFS_MAX_SCHEDULES_PER_ORG') ?? '',
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_SCHEDULES_PER_ORG;
}

export interface BriefsConfig {
  /**
   * The provider, key and model to use **right now**, or null when the selected
   * provider has no key yet. A getter, not a value — see the note below.
   */
  readonly llm: LlmSettings | null;
  maxPromptChars: number;
  dispatcherIntervalSeconds: number;
  backfillMaxBriefs: number;
}

/**
 * `llm` is a **getter** — see the same note on `loadCommitAnalysisConfig`. The
 * settings screen writes the provider, the key and the model override long
 * after the module graph is built, so a snapshot would need an app restart to
 * take effect. A null `llm` is the "not configured" signal, checked by
 * `BriefGeneratorService` at call time.
 */
export function loadBriefsConfig(config: ConfigService): BriefsConfig {
  const maxPromptChars = Number.parseInt(
    config.get<string>('BRIEFS_MAX_PROMPT_CHARS') ?? '',
    10,
  );
  const dispatcherIntervalSeconds = Number.parseInt(
    config.get<string>('BRIEFS_DISPATCHER_INTERVAL_SECONDS') ?? '',
    10,
  );
  const backfillMaxBriefs = Number.parseInt(
    config.get<string>('BRIEFS_BACKFILL_MAX_BRIEFS') ?? '',
    10,
  );

  return {
    get llm(): LlmSettings | null {
      return loadLlmSettings(config, {
        providerVar: 'BRIEFS_LLM_PROVIDER',
        modelVars: BRIEF_MODEL_VARS,
        job: 'brief',
      });
    },
    maxPromptChars:
      Number.isFinite(maxPromptChars) && maxPromptChars > 0
        ? maxPromptChars
        : DEFAULT_MAX_PROMPT_CHARS,
    dispatcherIntervalSeconds:
      Number.isFinite(dispatcherIntervalSeconds) &&
      dispatcherIntervalSeconds > 0
        ? dispatcherIntervalSeconds
        : DEFAULT_DISPATCHER_INTERVAL_SECONDS,
    backfillMaxBriefs:
      Number.isFinite(backfillMaxBriefs) && backfillMaxBriefs > 0
        ? backfillMaxBriefs
        : DEFAULT_BACKFILL_MAX_BRIEFS,
  };
}
