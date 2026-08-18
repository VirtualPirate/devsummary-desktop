import type { ConfigService } from '@nestjs/config';

export const DEFAULT_MAX_PROMPT_CHARS = 30_000;
export const DEFAULT_DISPATCHER_INTERVAL_SECONDS = 60;
export const DEFAULT_BRIEF_MODEL = 'gpt-4o-mini';
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
 * still apply when `loadBriefsConfig` returns null for a missing OPENAI_API_KEY.
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
  apiKey: string;
  model: string;
  maxPromptChars: number;
  dispatcherIntervalSeconds: number;
  backfillMaxBriefs: number;
}

/**
 * `apiKey` and `model` are **getters** — see the same note on
 * `loadCommitAnalysisConfig`. The settings screen writes both long after the
 * module graph is built, so a snapshot would need an app restart to take
 * effect. An empty `apiKey` is the "not configured" signal, checked by
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
    get apiKey(): string {
      return config.get<string>('OPENAI_API_KEY') ?? '';
    },
    get model(): string {
      return config.get<string>('OPENAI_BRIEF_MODEL') || DEFAULT_BRIEF_MODEL;
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
