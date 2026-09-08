import type { ConfigService } from '@nestjs/config';

export const LLM_PROVIDERS = ['openai', 'gemini'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/**
 * Gemini's OpenAI-compatible endpoint. Pointing the `openai` SDK at it is what
 * lets one client hierarchy serve both providers — no second SDK, no second
 * transport. It speaks `/chat/completions`, *not* `/responses`, which is the
 * only thing `GeminiLlmClient` exists to say.
 */
export const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/';

const API_KEY_VAR: Record<LlmProvider, string> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-3.1-flash-lite',
};

/** Everything an `LlmClient` needs to talk to one provider. */
export interface LlmSettings {
  provider: LlmProvider;
  apiKey: string;
  /** Unset for OpenAI (SDK default); Gemini's compat base otherwise. */
  baseURL?: string;
  model: string;
}

function isProvider(value: string): value is LlmProvider {
  return (LLM_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Scope var wins over the global `LLM_PROVIDER`, so briefs and commit analysis
 * can sit on different providers (cheap model for per-commit volume, stronger
 * one for the customer-facing brief) without a code change.
 *
 * A typo throws rather than falling back: silently defaulting `gemeni` to
 * OpenAI spends money on the provider the operator thought they had left.
 */
export function resolveLlmProvider(
  config: ConfigService,
  scopeVar?: string,
): LlmProvider {
  for (const key of [scopeVar, 'LLM_PROVIDER']) {
    if (!key) continue;
    const raw = config.get<string>(key)?.trim().toLowerCase();
    if (!raw) continue;
    if (!isProvider(raw)) {
      throw new Error(
        `Invalid ${key}="${raw}". Expected one of: ${LLM_PROVIDERS.join(', ')}`,
      );
    }
    return raw;
  }
  return 'openai';
}

export interface LoadLlmSettingsOptions {
  /** e.g. `BRIEFS_LLM_PROVIDER`; falls back to `LLM_PROVIDER`. */
  providerVar: string;
  /** Model env var per provider, e.g. `{ openai: 'OPENAI_BRIEF_MODEL', … }`. */
  modelVars: Record<LlmProvider, string>;
}

/**
 * Null when the selected provider has no API key — callers turn that into the
 * existing stub-that-rejects pattern rather than failing boot.
 */
export function loadLlmSettings(
  config: ConfigService,
  opts: LoadLlmSettingsOptions,
): LlmSettings | null {
  const provider = resolveLlmProvider(config, opts.providerVar);
  const apiKey = config.get<string>(API_KEY_VAR[provider])?.trim();
  if (!apiKey) return null;

  return {
    provider,
    apiKey,
    baseURL: provider === 'gemini' ? GEMINI_BASE_URL : undefined,
    model:
      config.get<string>(opts.modelVars[provider])?.trim() ||
      DEFAULT_MODELS[provider],
  };
}
