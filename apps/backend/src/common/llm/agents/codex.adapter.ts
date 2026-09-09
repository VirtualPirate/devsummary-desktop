import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentCliAdapter, AgentCliOutput } from './agent-cli.adapter';
import {
  firstLine,
  lastOfType,
  parseJsonLines,
  stripFence,
} from './agent-cli.helpers';

/**
 * One line of `codex exec --json`, only the fields we read. Three event types
 * carry everything: `item.completed` wrapping an `agent_message` is the answer,
 * `turn.completed` carries usage, `turn.failed` carries the failure. The rest
 * of the stream is progress.
 */
interface CodexEvent {
  type: string;
  item?: { type?: unknown; text?: unknown };
  /** Top-level `error` events: one per retry attempt. */
  message?: unknown;
  /** `turn.failed`. */
  error?: { message?: unknown };
  /** `turn.completed`. Cumulative over every model call the turn made. */
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

const scratch = process.env.DATA_DIR ?? tmpdir();

/**
 * An empty directory to run in. `-C` sets the working root, which defaults to
 * the process cwd — this repository in development — and codex reads the root's
 * `AGENTS.md` into the prompt. The point of this directory is that there is
 * nothing in it to read.
 *
 * Under `DATA_DIR` rather than `tmpdir()` for the same reason Cursor's is: on
 * Linux `tmpdir()` is the shared `/tmp`, a fixed path there can be pre-created
 * or symlinked by any other local user, and `mkdir(…, { recursive: true })`
 * follows the symlink and succeeds. `DATA_DIR` is the Electron `userData`
 * folder, which is per user; the fallback is for headless dev only.
 */
const workspaceDir = join(scratch, 'codex-workspace');

/**
 * `--output-schema` takes a **path**, not inline JSON, which is why this
 * adapter has a `files` hook at all. Kept out of `workspaceDir` so the working
 * root stays empty.
 */
const schemaDir = join(scratch, 'codex-schemas');

/**
 * One file per schema, so two concurrent calls either share a file whose bytes
 * are identical or use different files. The scrub is belt and braces: schema
 * names are ours, and a name is about to become a path.
 */
const schemaFile = (schemaName: string): string =>
  join(schemaDir, `${schemaName.replace(/[^\w.-]/g, '_')}.json`);

/** A TOML basic string. JSON's escapes are a subset of TOML's, so this is one. */
const toml = (value: string): string => JSON.stringify(value);

/** The `agent_message` items, newest last — a turn can produce several. */
const lastMessage = (events: CodexEvent[]): string | null => {
  const messages = events.filter(
    (event) =>
      event.type === 'item.completed' &&
      event.item?.type === 'agent_message' &&
      typeof event.item.text === 'string',
  );
  return (messages.at(-1)?.item?.text as string | undefined) ?? null;
};

const message = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const codexAdapter: AgentCliAdapter = {
  id: 'codex',
  displayName: 'Codex',
  binary: 'codex',
  installHint:
    'Install it with `npm i -g @openai/codex` (or `brew install codex`), then run `codex login`.',
  versionArgs: ['--version'],
  authArgs: ['login', 'status'],
  workspaceDir,

  /**
   * `-s read-only` is the trust boundary, and it is a narrower one than the
   * other three adapters have: codex `exec` always has a shell tool and there
   * is no config key that removes it. Measured against 0.153.4
   * (`docs/receipts/AGENT-CLI-CODEX.md`): writes are refused, the network is
   * unreachable from a spawned command, and reads are **not** confined to the
   * workspace — an absolute path still reads.
   *
   * `shell_environment_policy.inherit="none"` and `allow_login_shell=false` are
   * what make that survivable, and **both** are load-bearing. `SecretsService`
   * writes the decrypted bundle — the OpenAI key, the GitHub PAT, the database
   * encryption key — straight into `process.env`, and every command the model
   * runs would otherwise inherit it. The environment policy alone does not
   * hold: codex runs commands through `/bin/zsh -lc` by default, and a login
   * shell re-sources the user's profile and rebuilds the environment it was
   * just denied. Measured with a canary variable: `-lc` echoed it back,
   * `-c` with both keys echoed an empty string and a `PATH` holding only
   * codex's own two directories.
   *
   * Never add `--dangerously-bypass-approvals-and-sandbox`,
   * `--dangerously-bypass-hook-trust`, `--approve-for-me`, `--add-dir`, or
   * `-s workspace-write` / `danger-full-access`: each one hands back write or
   * shell access to a model whose prompt is an untrusted commit diff.
   *
   * `--skip-git-repo-check` is load-bearing — the scratch workspace is not a
   * git repository, and without the flag codex exits 1 with "Not inside a
   * trusted directory". `--ephemeral` keeps the run out of the user's session
   * history; `--ignore-user-config` and `--ignore-rules` keep their
   * `config.toml`, MCP servers and execpolicy files out of it.
   */
  buildArgs: (req) => [
    'exec',
    '--json',
    '-s',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '-C',
    workspaceDir,
    '--output-schema',
    schemaFile(req.schemaName),
    '-m',
    req.model,
    // `instructions` **replaces** codex's base system prompt rather than
    // appending to it: measured at 14 082 input tokens per spawn before, 10 543
    // after. It is also the only real system-prompt slot `exec` has — there is
    // no `--system-prompt` flag.
    '-c',
    `instructions=${toml(req.systemPrompt)}`,
    '-c',
    `shell_environment_policy.inherit=${toml('none')}`,
    '-c',
    'allow_login_shell=false',
    // The prompt comes from stdin: diffs reach 60k chars.
    '-',
  ],

  /**
   * The one thing that made this adapter need a hook: `--output-schema` names a
   * file. The schema is written before the spawn, so codex enforces the shape
   * itself and there is no JSON-only instruction to be talked out of.
   */
  files: (req) => ({
    [schemaFile(req.schemaName)]: JSON.stringify(req.jsonSchema),
  }),

  /**
   * **An `error` item is not a failure.** codex reports "Model metadata for `x`
   * not found" and "Skill descriptions were shortened" as `item.completed`
   * events of type `error` on runs that go on to answer perfectly. The two
   * events that decide are `turn.failed` and the `agent_message` item; the exit
   * code agrees with them and is only consulted when the stream said nothing.
   */
  parseOutput: ({ code, stdout, stderr }): AgentCliOutput => {
    const events = parseJsonLines<CodexEvent>(stdout);

    const answer = lastMessage(events);
    if (answer !== null) {
      let raw: unknown;
      try {
        raw = JSON.parse(stripFence(answer));
      } catch {
        // The process ran fine and the body cannot change on a retry.
        return { ok: false, kind: 'invalid', reason: 'answer was not JSON' };
      }

      const usage = lastOfType(events, 'turn.completed')?.usage ?? {};
      return {
        ok: true,
        // No event names the resolved model; the client falls back to the
        // configured string.
        model: null,
        raw,
        // `input_tokens` is the **total**, with `cached_input_tokens` and
        // `cache_write_input_tokens` as breakdowns of it — adding them would
        // double-count. Measured: a prompt 4797 tokens longer moved the total
        // from 14 082 to 18 879 while the cache field tracked it. Likewise
        // `output_tokens` already includes `reasoning_output_tokens`.
        promptTokens:
          typeof usage.input_tokens === 'number' ? usage.input_tokens : null,
        completionTokens:
          typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
      };
    }

    return {
      ok: false,
      // Every one of these is the CLI or its provider failing, never a body
      // that a retry could not fix, so the retry path stays correct.
      kind: 'transport',
      reason:
        message(lastOfType(events, 'turn.failed')?.error?.message) ||
        // A stream cut short by the timeout has no `turn.failed`; the retry
        // notices are then the only account of why.
        message(lastOfType(events, 'error')?.message) ||
        firstLine(stderr) ||
        (code === 0
          ? 'codex produced no answer'
          : `codex exited with code ${code}`),
    };
  },

  /** `Logged in using an API key …` / `Not logged in`. Plain text, not JSON. */
  parseAuth: (stdout) => firstLine(stdout).startsWith('Logged in'),
};
