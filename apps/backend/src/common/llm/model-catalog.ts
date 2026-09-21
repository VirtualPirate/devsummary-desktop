import { Logger } from '@nestjs/common';
import {
  AGENT_ADAPTERS,
  isAgentProvider,
  runCli,
  type AgentCliDetector,
  type AgentProvider,
  type RunCli,
} from './agents';
// Straight from the helpers file: `agents/index.ts` does not re-export it, and
// widening that barrel is how the detector/adapter require cycle starts.
import { stripAnsi } from './agents/agent-cli.helpers';
import { GEMINI_BASE_URL, type LlmProvider } from './llm-config';

/** A catalogue is a convenience, not a dependency: it never blocks the page. */
const TIMEOUT_MS = 15_000;

/**
 * An empty list is a legitimate answer, so it is also the answer every failure
 * gives — which is exactly the shape that is impossible to diagnose from the
 * screen. The reason is logged rather than returned: the picker's fallback is
 * the same either way, and the user is not the one who can act on `exit 127`.
 */
const logger = new Logger('ModelCatalog');

const OPENAI_BASE_URL = 'https://api.openai.com/v1/';

/**
 * What the picker must not offer. The `/models` listing of both keyed providers
 * is the whole account catalogue — embeddings, speech, images, moderation — and
 * none of those can answer a structured chat completion.
 */
const NOT_CHAT =
  /embed|whisper|tts|audio|speech|dall-e|image|moderation|rerank|transcrib|veo|imagen/i;

/**
 * Models to offer for one provider, best effort: **an empty list is a normal
 * answer**, not an error. A missing binary, a CLI that cannot list, a rejected
 * key or an unreachable API all end here, and the picker falls back to a typed
 * model id — which is the only thing that works for an id no catalogue knows.
 */
export async function listProviderModels(
  provider: LlmProvider,
  apiKey: string | undefined,
  detector: AgentCliDetector,
  /** Injected so a test never spawns, same as the detector's own runner. */
  run: RunCli = runCli,
): Promise<string[]> {
  return isAgentProvider(provider)
    ? cliModels(provider, detector, run)
    : keyedModels(provider, apiKey);
}

async function cliModels(
  provider: AgentProvider,
  detector: AgentCliDetector,
  run: RunCli,
): Promise<string[]> {
  const adapter = AGENT_ADAPTERS[provider];
  const catalogue = adapter.models;
  // `'args' in` rather than `Array.isArray`: the array half is `readonly`, and
  // the type guard does not narrow a readonly array out of a union.
  if (!('args' in catalogue)) return [...catalogue];

  const path = await detector.binaryPath(adapter);
  if (!path) {
    // Distinct from a catalogue that ran and said nothing: this is the detector
    // reporting no runnable binary, which is the card's problem, not the
    // picker's.
    logger.warn(`${provider} has no runnable binary, so no models are offered`);
    return [];
  }

  try {
    const result = await run(path, catalogue.args, {
      timeoutMs: TIMEOUT_MS,
    });
    if (result.code !== 0) {
      logger.warn(
        `${provider} model catalogue exited ${result.code}: ${firstLine(result.stderr)}`,
      );
      return [];
    }
    // Stripped here rather than in each adapter: every one of these CLIs
    // colours its output when `FORCE_COLOR` is set, which is exactly what both
    // shells that launch this backend do.
    const models = dedupe(catalogue.parse(stripAnsi(result.stdout)));
    if (models.length === 0) {
      logger.warn(
        `${provider} model catalogue parsed to nothing from ${result.stdout.length} chars of stdout`,
      );
    }
    return models;
  } catch (err) {
    logger.warn(`${provider} model catalogue failed: ${describe(err)}`);
    return [];
  }
}

async function keyedModels(
  provider: 'openai' | 'gemini',
  apiKey: string | undefined,
): Promise<string[]> {
  if (!apiKey) return [];
  const base = provider === 'gemini' ? GEMINI_BASE_URL : OPENAI_BASE_URL;
  try {
    const response = await fetch(`${base}models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn(`${provider} model listing answered HTTP ${response.status}`);
      return [];
    }
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (body.data ?? [])
      .map((m) => (typeof m.id === 'string' ? m.id : ''))
      // Gemini's compat listing names them `models/gemini-…`; the completion
      // call takes either form, and the bare one is what the defaults use.
      .map((id) => id.replace(/^models\//, ''))
      .filter((id) => id.length > 0 && !NOT_CHAT.test(id));
    return dedupe(ids).sort();
  } catch (err) {
    logger.warn(`${provider} model listing failed: ${describe(err)}`);
    return [];
  }
}

const describe = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const firstLine = (text: string): string =>
  text.trim().split('\n')[0]?.slice(0, 200) ?? '(no stderr)';

const dedupe = (ids: string[]): string[] => [...new Set(ids)];
