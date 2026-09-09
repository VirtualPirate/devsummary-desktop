import type { AgentCliAdapter, AgentCliOutput } from './agent-cli.adapter';
import {
  firstLine,
  isEnvelope,
  parseStdout,
  sumTokens,
} from './agent-cli.helpers';

/** The `claude -p --output-format json` envelope, only the fields we read. */
interface ClaudeResult {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
}

/** The fields that mark this CLI's result envelope. */
const ENVELOPE_MARKERS = ['is_error', 'result', 'structured_output'] as const;

/**
 * The resolved model id, which the CLI reports as the sole key of `modelUsage`.
 * More than one key means the run fanned out and no single id describes it, so
 * the client falls back to the configured model string.
 */
function soleModel(usage: Record<string, unknown> | undefined): string | null {
  const keys = usage ? Object.keys(usage) : [];
  return keys.length === 1 ? keys[0] : null;
}

export const claudeCodeAdapter: AgentCliAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  binary: 'claude',
  installHint:
    'Install it with `npm i -g @anthropic-ai/claude-code`, then run `claude` once and `/login`.',
  versionArgs: ['--version'],
  authArgs: ['auth', 'status'],

  buildArgs: (req) => [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(req.jsonSchema),
    // `--tools ''` removes every tool. `--disallowedTools '*'` looks equivalent
    // and is not: it also blocks the internal StructuredOutput tool, and the
    // model answers in prose. `--bare` must never appear either — it drops the
    // claude.ai login and every call comes back "Not logged in".
    '--tools',
    '',
    '--model',
    req.model,
    '--system-prompt',
    req.systemPrompt,
    '--no-session-persistence',
  ],

  /**
   * **The envelope wins over the exit code.** A logged-out `claude` 2.1.265
   * exits **1** *and* prints the full result envelope, with the sentence a user
   * can act on in `result` ("Not logged in · Please run /login"). Branching on
   * the code first reported the whole ~1.5 KB JSON blob as the reason and never
   * reached that field — verified live, see
   * `docs/receipts/AGENT-CLI-CLAUDE-CODE.md`. So whenever the envelope is on
   * stdout it is the answer, whatever the process exited with; the exit code
   * only speaks for runs that produced no envelope at all.
   */
  parseOutput: ({ code, stdout, stderr }): AgentCliOutput => {
    const json = parseStdout(stdout);
    const body =
      json.object && isEnvelope(json.object, ENVELOPE_MARKERS)
        ? (json.object as ClaudeResult)
        : null;

    if (body) {
      // `is_error` is the CLI reporting its own failure — transport, not a bad
      // body, so the retry path stays correct.
      if (body.is_error) {
        return {
          ok: false,
          kind: 'transport',
          reason: body.result?.trim() || 'claude reported an error',
        };
      }

      if (
        body.structured_output === undefined ||
        body.structured_output === null
      ) {
        return {
          ok: false,
          kind: 'invalid',
          reason: 'response had no structured_output',
        };
      }

      const usage = body.usage ?? {};
      return {
        ok: true,
        raw: body.structured_output,
        model: soleModel(body.modelUsage),
        promptTokens: sumTokens(
          usage.input_tokens,
          usage.cache_creation_input_tokens,
          usage.cache_read_input_tokens,
        ),
        completionTokens: usage.output_tokens ?? null,
      };
    }

    // No envelope: the run died before it could print one, or printed
    // something else entirely.
    if (code !== 0) {
      return {
        ok: false,
        kind: 'transport',
        reason:
          firstLine(stderr) ||
          firstLine(stdout) ||
          `claude exited with code ${code}`,
      };
    }

    // Exited cleanly with no envelope. JSON that is simply not the envelope is
    // a usable process answering badly, which is `invalid` — calling it
    // transport would put a body that cannot change back on the retry path.
    // Gated on `parsed`, not on `object`: a bare array is just as unfixable by
    // a retry as an object with the wrong keys.
    return {
      ok: false,
      kind: json.parsed ? 'invalid' : 'transport',
      reason: firstLine(stdout) || 'claude produced no output',
    };
  },

  parseAuth: (stdout) => {
    try {
      return (JSON.parse(stdout) as { loggedIn?: unknown }).loggedIn === true;
    } catch {
      return false;
    }
  },
};
