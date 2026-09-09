import type { AgentCliAdapter, AgentCliOutput } from './agent-cli.adapter';
import {
  firstLine,
  jsonContractPrompt,
  lastOfType,
  parseJsonLines,
  stripFence,
} from './agent-cli.helpers';

/**
 * The inline agent this adapter defines and then selects with `--agent`. Its
 * `prompt` replaces opencode's default **build** prompt — that is what takes a
 * call from ~24 700 input tokens (the build agent and its tool docs) down to
 * ~430. It does *not* replace the whole system prompt: opencode still appends
 * its `<env>` block and one global instruction file **after** ours.
 *
 * ponytail: `~/.config/opencode/AGENTS.md` (or `~/.claude/CLAUDE.md` when that
 * one is absent) is appended in the last, most influential position, and 1.1.53
 * offers no way to suppress it — `instructions: []` in the config content is
 * unioned rather than replaced, and the global file list ignores config
 * entirely (both verified live: identical token counts either way). So a user's
 * personal instructions can still derail the JSON-only contract, which surfaces
 * as `OPENAI_RESPONSE_INVALID`. `OPENCODE_CONFIG_DIR` pointed at a scratch
 * directory holding an empty `AGENTS.md` would close it, at the cost of hiding
 * the user's own opencode config from the run.
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
 * opencode's own words when `--agent <name>` does not resolve. Verified
 * verbatim on 1.1.53: `! agent "x" not found. Falling back to default agent`,
 * written straight to stderr by its UI layer — so it appears at every
 * `--log-level`, and even with `--print-logs` absent.
 */
const AGENT_FELL_BACK = 'Falling back to default agent';

/**
 * The one log line that is safe to quote back to a user. opencode's `service=llm`
 * ERROR lines embed `requestBodyValues.messages`, i.e. the whole system prompt
 * and the commit diff; `service=session.processor` carries only the provider's
 * own sentence. Anything between `error=` and ` stack=` is that sentence.
 */
const SESSION_ERROR =
  /^ERROR .*\bservice=session\.processor\b.*\berror=(.*?)(?: stack=|$)/;

/**
 * SGR colour codes. opencode writes its stack traces coloured, and the reason
 * a user reads has to be that text without them. The rule is disabled rather
 * than worked around: ESC *is* the character being matched.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * The CLI's last word when stdout says nothing. A throttled OpenCode Zen call
 * is the case that needs it: opencode retries internally with backoff and
 * emits **no** JSON event at all, so without this the user waits out the whole
 * 120 s and is told "timed out" instead of "rate limited".
 *
 * The *last* match, because the retry loop logs one line per attempt.
 */
function sessionError(stderr: string): string | null {
  const lines = stderr.replace(ANSI, '').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const hit = SESSION_ERROR.exec(lines[i].trim());
    if (hit) return hit[1].trim() || null;
  }
  return null;
}

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
    // The rate-limit reason lives in opencode's log, not in the event stream,
    // and `ERROR` is the only level that stays silent on a healthy call
    // (measured: 0 bytes of stderr at ERROR, 260 kB at WARN, and INFO/DEBUG
    // overflow the 16 MiB read buffer *and* print the prompt).
    '--print-logs',
    '--log-level',
    'ERROR',
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
   * from an empty file list). The working directory's size does not matter for
   * a different reason: without the build prompt, opencode's `<directories>`
   * block is empty.
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
          // No `--json-schema` flag and no structured-output mode: the
          // instruction is the only contract there is.
          prompt: jsonContractPrompt(req),
          permission: { '*': 'deny' },
        },
      },
      // No `autoupdate: false` here: the upgrade check reads the user's global
      // config file rather than the merged one, so the key would be inert.
      // `OPENCODE_DISABLE_AUTOUPDATE` is what actually does it.
      share: 'disabled',
    }),
    // The user's project-level `opencode.json` / `AGENTS.md` walk-up must not
    // redefine the agent, hand it back its tools, or append this repo's own
    // instructions to the prompt.
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    // The global instruction file cannot be suppressed (see `AGENT_NAME`), but
    // this at least keeps the user's personal Claude Code memory from being the
    // file that wins when they have no opencode `AGENTS.md`.
    OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
  }),

  stderrHint: sessionError,

  /**
   * **The exit code carries no information.** opencode 1.1.53 exits **0** for
   * a 401 from the provider (the failure is an `error` event on stdout) *and*
   * for an unknown model (stdout empty, an ANSI Bun stack trace on stderr). So
   * the events decide, and stderr is consulted only when there were none.
   */
  parseOutput: ({ code, stdout, stderr }): AgentCliOutput => {
    // Before anything on stdout is trusted. If `OPENCODE_CONFIG_CONTENT` ever
    // fails to define the agent — a renamed env var in a future version, or a
    // machine-managed config, which merges *after* it — opencode says so on
    // stderr and then runs its default **build** agent instead: our system
    // prompt gone, our schema gone, `permission {'*': 'deny'}` gone, and tools
    // live in the backend's working directory with a commit diff as the
    // prompt. There are events in that case, so nothing downstream would look
    // at stderr. Refuse the run outright, however well-formed the answer is.
    if (stderr.replace(ANSI, '').includes(AGENT_FELL_BACK)) {
      return {
        ok: false,
        kind: 'transport',
        reason: `opencode ignored the ${AGENT_NAME} agent and ran with tools enabled`,
      };
    }

    const events = parseJsonLines<OpencodeEvent>(stdout);

    // Gated on the event, not on its payload: an `error` event is a failure
    // whether or not it carried one.
    const failed = lastOfType(events, 'error');
    if (failed) {
      // A provider error is transport, not a bad body: it is the CLI reporting
      // its own failure, and the retry path is the right one for it.
      const failure = failed.error ?? {};
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
      let raw: unknown;
      try {
        raw = JSON.parse(stripFence(answer));
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
        // `output` **already includes** reasoning: opencode reads it straight
        // from the provider's `output_tokens`, and reports `reasoning`
        // separately out of `output_tokens_details`. Adding them counts
        // reasoning twice (opencode's own cost display has that bug); a wrong
        // number on the usage card is worse than none.
        completionTokens: tokens ? (tokens.output ?? 0) : null,
      };
    }

    // Events, but never an answer. `transport`, not `invalid`: opencode fires
    // its event loop off unawaited, so a truncated stream is possible and a
    // retry can produce the body this run did not.
    if (events.length > 0) {
      return {
        ok: false,
        kind: 'transport',
        reason: 'opencode produced no answer',
      };
    }

    return {
      ok: false,
      kind: 'transport',
      reason:
        // The log line first: a throttled provider is the one failure whose
        // reason exists nowhere else.
        sessionError(stderr) ||
        firstLine(stderr, ERROR_LINE) ||
        firstLine(stdout) ||
        (code === 0
          ? 'opencode produced no output'
          : `opencode exited with code ${code}`),
    };
  },
};
