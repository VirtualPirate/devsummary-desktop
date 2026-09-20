import type { ConfigService } from '@nestjs/config';
import { isAgentProvider, type AgentProvider } from './agents';

export const LLM_PROVIDERS = [
  'openai',
  'gemini',
  'claude-code',
  'opencode',
  'cursor',
  'codex',
] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** The three calls the app makes, each with its own model. */
export type LlmJob = 'commitAnalysis' | 'brief' | 'agent';

/**
 * Gemini's OpenAI-compatible endpoint. Pointing the `openai` SDK at it is what
 * lets one client hierarchy serve both providers — no second SDK, no second
 * transport. It speaks `/chat/completions`, *not* `/responses`, which is the
 * only thing `GeminiLlmClient` exists to say.
 */
export const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/';

// Only the providers reached with a key have one. An agent CLI authenticates
// itself, so `Record<LlmProvider, …>` here would demand a var that cannot
// exist.
const API_KEY_VAR: Record<Exclude<LlmProvider, AgentProvider>, string> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

/**
 * Per provider **and** per job. Agent CLIs can use a cheap model for per-commit
 * volume and a stronger one for the brief people actually read, which one
 * string per provider cannot express; OpenAI and Gemini keep the same value in
 * the two one-shot slots.
 *
 * `agent` sits above both on every provider: the agent picks tools in a loop and
 * a wrong pick costs a whole extra turn, where per-commit analysis is one shot
 * at one diff.
 */
export const DEFAULT_MODELS: Record<
  LlmProvider,
  { commitAnalysis: string; brief: string; agent: string }
> = {
  openai: {
    commitAnalysis: 'gpt-4o-mini',
    brief: 'gpt-4o-mini',
    agent: 'gpt-4o',
  },
  gemini: {
    commitAnalysis: 'gemini-3.1-flash-lite',
    brief: 'gemini-3.1-flash-lite',
    agent: 'gemini-3.6-flash',
  },
  'claude-code': { commitAnalysis: 'haiku', brief: 'sonnet', agent: 'sonnet' },
  // OpenCode ids are always `provider/model`, and the provider half has to be
  // one the user connected with `opencode auth login` — opencode holds its own
  // credentials and this app never sees them, so no default can be right for
  // everyone. OpenAI is the likeliest connection and the same Luna/Terra pair
  // codex defaults to, which makes a wrong guess fail as
  // `ProviderModelNotFoundError` in ~2 s against a model hint that says to run
  // `opencode models` — a failure that names its own fix.
  //
  // It is *not* Zen's free tier any more. `opencode/big-pickle` and every
  // other `opencode/*` id now answers HTTP 403 `FreeTierError`, "OpenCode's
  // free tier can only be used from within OpenCode", to anything that is not
  // the opencode TUI — measured 2026-09-18 on 1.1.53 across big-pickle and
  // three `-free` siblings, 4 calls each, 16/16. The old ceiling was a quota
  // that ran out after two calls; this one never starts.
  opencode: {
    commitAnalysis: 'openai/gpt-5.6-luna',
    brief: 'openai/gpt-5.6-terra',
    agent: 'openai/gpt-5.6-terra',
  },
  cursor: {
    commitAnalysis: 'composer-2.5-fast',
    brief: 'composer-2.5',
    agent: 'composer-2.5',
  },
  // Codex's own model notes: Luna is the nano-like tier, Terra the mid one,
  // "use Sol only if quality requires it".
  codex: {
    commitAnalysis: 'gpt-5.6-luna',
    brief: 'gpt-5.6-terra',
    agent: 'gpt-5.6-terra',
  },
};

/** Everything an `LlmClient` needs to talk to one provider. */
export interface LlmSettings {
  provider: LlmProvider;
  /**
   * Absent for a provider that is a local CLI: it authenticates itself and
   * there is no key to store.
   */
  apiKey?: string;
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
  /** Which of the provider's two defaults applies when no override is set. */
  job: LlmJob;
}

/**
 * Null when the selected provider has no API key — callers turn that into the
 * existing stub-that-rejects pattern rather than failing boot. A CLI provider
 * is never null: it has no key to be missing, and whether the binary is
 * actually there is the detector's question at call time. A config read must
 * not spawn a process.
 */
export function loadLlmSettings(
  config: ConfigService,
  opts: LoadLlmSettingsOptions,
): LlmSettings | null {
  const provider = resolveLlmProvider(config, opts.providerVar);
  const model =
    config.get<string>(opts.modelVars[provider])?.trim() ||
    DEFAULT_MODELS[provider][opts.job];

  if (isAgentProvider(provider)) return { provider, model };

  const apiKey = config.get<string>(API_KEY_VAR[provider])?.trim();
  if (!apiKey) return null;

  return {
    provider,
    apiKey,
    baseURL: provider === 'gemini' ? GEMINI_BASE_URL : undefined,
    model,
  };
}
