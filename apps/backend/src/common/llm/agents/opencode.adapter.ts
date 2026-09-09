import type {
  AgentCliAdapter,
  AgentCliOutput,
  AgentCliRequest,
} from './agent-cli.adapter';

/**
 * The inline agent this adapter defines and then selects with `--agent`. Its
 * `prompt` **replaces** opencode's default system prompt, which is what takes
 * a call from ~24 700 input tokens (the default build agent, tool docs and
 * all) down to ~400.
 */
const AGENT_NAME = 'devsummary';

/** One event line of `--format json`, only the fields we read. */
interface OpencodeEvent {
  type: string;
  part?: {
    text?: unknown;
    tokens?: {
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: { read?: number; write?: number };
    };
  };
  error?: { name?: unknown; data?: { message?: unknown } };
}

/** A line that names a thrown error, e.g. `ProviderModelNotFoundError: …`. */
const ERROR_LINE = /^\w*Error\b/;

/**
 * SGR colour codes. opencode writes its stack traces coloured, and the reason
 * a user reads has to be that text without them. The rule is disabled rather
 * than worked around: ESC *is* the character being matched.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** ```` ```json … ``` ```` the model added despite being told not to. */
const FENCE = /^```[a-z]*\n?([\s\S]*?)\n?```$/i;

/**
 * The first line matching `pattern`, else the first non-blank line, else ''.
 */
function firstLine(text: string, pattern?: RegExp): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    (pattern && lines.find((line) => pattern.test(line))) || lines[0] || ''
  );
}

/**
 * stdout is JSON lines, one event per line — not one envelope. Anything that
 * is not an object with a string `type` is dropped rather than failing the
 * run: the stream is not guaranteed to be JSON-only, and a progress notice
 * must not cost the answer printed after it.
 */
function parseEvents(stdout: string): OpencodeEvent[] {
  const events: OpencodeEvent[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { type?: unknown }).type === 'string'
    ) {
      events.push(value as OpencodeEvent);
    }
  }
  return events;
}

/** The stream is incremental, so the *last* event of a type is the real one. */
const lastOfType = (
  events: OpencodeEvent[],
  type: string,
): OpencodeEvent | undefined => events.filter((e) => e.type === type).at(-1);

/**
 * The system prompt carries the schema, because there is no `--json-schema`
 * flag and no structured-output mode: the instruction is the only contract.
 */
const systemPrompt = (req: AgentCliRequest): string =>
  `${req.systemPrompt}\n\nAnswer with exactly one JSON object matching the JSON Schema named ${req.schemaName} below — no markdown fences, no prose, nothing before or after it.\n${JSON.stringify(req.jsonSchema)}`;

export const opencodeAdapter: AgentCliAdapter = {
  id: 'opencode',
  displayName: 'OpenCode',
  binary: 'opencode',
  installHint:
    'Install it with `curl -fsSL https://opencode.ai/install | bash` (or `brew install sst/tap/opencode`), then run `opencode auth login` and connect the provider your model needs — OpenCode Zen for the default `opencode/big-pickle`.',
  versionArgs: ['--version'],

  // No `authArgs`: credentials are per provider *inside* opencode
  // (`opencode auth login`, stored in its own `auth.json`), so there is no
  // single logged-in state to probe and the card reports none.

  buildArgs: (req) => [
    'run',
    '--format',
    'json',
    '--agent',
    AGENT_NAME,
    '--model',
    req.model,
  ],

  /**
   * Everything that is not a model id arrives here, because opencode has no
   * flag for any of it: the agent — system prompt *and* tool policy — is one
   * inline JSON config merged over the user's own. `permission {'*': 'deny'}`
   * is what turns every tool off (asked to list a directory, the model answers
   * from an empty file list), and it is the reason the working directory's size
   * does not matter.
   *
   * ponytail: every run is still persisted as a session in opencode's own
   * database — 1.1.53 has no opt-out flag. Point `XDG_DATA_HOME` at a scratch
   * directory here if that becomes a problem, and accept that the user's
   * `opencode auth login` credentials live under the same root.
   */
  env: (req) => ({
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      agent: {
        [AGENT_NAME]: {
          mode: 'primary',
          prompt: systemPrompt(req),
          permission: { '*': 'deny' },
        },
      },
      share: 'disabled',
      autoupdate: false,
    }),
    // The user's project-level `opencode.json` must not redefine the agent or
    // hand it back its tools.
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
  }),

  /**
   * **The exit code carries no information.** opencode 1.1.53 exits **0** for
   * a 401 from the provider (the failure is an `error` event on stdout) *and*
   * for an unknown model (stdout empty, an ANSI Bun stack trace on stderr). So
   * the events decide, and stderr is consulted only when there were none.
   */
  parseOutput: ({ code, stdout, stderr }): AgentCliOutput => {
    const events = parseEvents(stdout);

    const failure = lastOfType(events, 'error')?.error;
    if (failure) {
      // A provider error is transport, not a bad body: it is the CLI reporting
      // its own failure, and the retry path is the right one for it.
      const message = failure.data?.message;
      return {
        ok: false,
        kind: 'transport',
        reason:
          (typeof message === 'string' && message.trim()) ||
          (typeof failure.name === 'string' && failure.name) ||
          'opencode reported an error',
      };
    }

    const answer = lastOfType(events, 'text')?.part?.text;
    if (typeof answer === 'string') {
      const body = answer.trim();
      const json = FENCE.exec(body)?.[1]?.trim() ?? body;
      let raw: unknown;
      try {
        raw = JSON.parse(json);
      } catch {
        // The process ran fine and the body cannot change on a retry, so this
        // is `invalid` — never transport.
        return { ok: false, kind: 'invalid', reason: 'answer was not JSON' };
      }

      const tokens = lastOfType(events, 'step_finish')?.part?.tokens;
      return {
        ok: true,
        raw,
        // No event names the resolved model; the client falls back to the
        // configured string.
        model: null,
        promptTokens: tokens
          ? (tokens.input ?? 0) +
            (tokens.cache?.read ?? 0) +
            (tokens.cache?.write ?? 0)
          : null,
        // Reasoning is billed as output, and the caller stores one number.
        completionTokens: tokens
          ? (tokens.output ?? 0) + (tokens.reasoning ?? 0)
          : null,
      };
    }

    // Events, but never an answer: a run that ended without saying anything is
    // still a usable process with an unusable result.
    if (events.length > 0) {
      return { ok: false, kind: 'invalid', reason: 'answer was not JSON' };
    }

    return {
      ok: false,
      kind: 'transport',
      reason:
        firstLine(stderr.replace(ANSI, ''), ERROR_LINE) ||
        firstLine(stdout) ||
        (code === 0
          ? 'opencode produced no output'
          : `opencode exited with code ${code}`),
    };
  },
};
