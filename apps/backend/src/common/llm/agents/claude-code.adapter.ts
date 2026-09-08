import type { AgentCliAdapter, AgentCliOutput } from './agent-cli.adapter';

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

const firstLine = (text: string): string =>
  text.trim().split('\n')[0]?.trim() ?? '';

/** Null only when the envelope reported no usage at all. */
function sumTokens(...values: Array<number | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === 'number');
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}

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

  parseOutput: ({ code, stdout, stderr }): AgentCliOutput => {
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

    let body: ClaudeResult;
    try {
      body = JSON.parse(stdout) as ClaudeResult;
    } catch {
      return {
        ok: false,
        kind: 'transport',
        reason: firstLine(stdout) || 'claude produced no output',
      };
    }

    // Exit code 0 with `is_error` is how a logged-out CLI answers, so this is
    // transport and not a bad body.
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
  },

  parseAuth: (stdout) => {
    try {
      return (JSON.parse(stdout) as { loggedIn?: unknown }).loggedIn === true;
    } catch {
      return false;
    }
  },
};
