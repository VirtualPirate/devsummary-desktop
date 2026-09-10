import type { AgentCliAdapter, AgentCliOutput } from './agent-cli.adapter';
import {
  firstLine,
  isEnvelope,
  jsonContractPrompt,
  parseStdout,
  scratchDir,
  stripFence,
  sumTokens,
} from './agent-cli.helpers';

/** The `agent -p --output-format json` envelope, only the fields we read. */
interface CursorResult {
  is_error?: unknown;
  result?: unknown;
  usage?: {
    inputTokens?: unknown;
    outputTokens?: unknown;
    cacheReadTokens?: unknown;
    cacheWriteTokens?: unknown;
  };
}

/** The fields that mark this CLI's result envelope. */
const ENVELOPE_MARKERS = ['is_error', 'result'] as const;

/**
 * An empty directory to run in, because `--workspace` defaults to the process
 * cwd — which for the packaged backend is wherever Electron started it, and in
 * development is this repository, `AGENTS.md` and all. Cursor reads the
 * workspace's instruction files into the prompt, so the point of this directory
 * is that there is nothing in it to read. `scratchDir` is where it lives, and
 * why it lives there.
 */
const workspaceDir = scratchDir('cursor-workspace');

export const cursorAdapter: AgentCliAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  binary: 'agent',
  installHint:
    'Install it with `curl https://cursor.com/install -fsS | bash`, then run `agent login`.',
  versionArgs: ['--version'],
  authArgs: ['status', '--format', 'json'],
  workspaceDir,

  /**
   * `--mode ask` is the read-only lock: `-p` alone "has access to all tools,
   * including write and shell" in the CLI's own words. Verified live — asked
   * for a file write and a shell command in ask mode, the workspace stayed
   * empty (`docs/receipts/AGENT-CLI-CURSOR.md`). `--trust` only skips the
   * "do you trust this folder" prompt, which a headless run cannot answer.
   *
   * Never add `--force`, `--yolo`, `--auto-review` or `--approve-mcps`: the
   * first three hand back write and shell access, and the last one silently
   * enables whatever MCP servers the user has configured.
   */
  buildArgs: (req) => [
    '-p',
    '--output-format',
    'json',
    '--mode',
    'ask',
    '--trust',
    '--workspace',
    workspaceDir,
    '--model',
    req.model,
  ],

  /**
   * Everything goes through stdin: there is no `--system-prompt` and no
   * `--json-schema`, and the prompt is far too long for argv.
   */
  stdin: (req, userPrompt) => `${jsonContractPrompt(req)}\n\n${userPrompt}`,

  /**
   * **The envelope wins over the exit code**, same as Claude Code: a failure
   * the CLI describes in `result` is worth more to a user than the number it
   * exited with. Failures that never produced an envelope — an unknown model, a
   * missing workspace — are plain text on stderr, and the exit code speaks for
   * those.
   */
  parseOutput: ({ code, stdout, stderr }): AgentCliOutput => {
    const json = parseStdout(stdout);
    const body =
      json.object && isEnvelope(json.object, ENVELOPE_MARKERS)
        ? (json.object as CursorResult)
        : null;

    if (body) {
      // The CLI reporting its own failure is transport, not a bad body, so the
      // retry path stays correct.
      if (body.is_error) {
        return {
          ok: false,
          kind: 'transport',
          reason:
            (typeof body.result === 'string' && body.result.trim()) ||
            'agent reported an error',
        };
      }

      // `result` is a JSON *string*, not a nested object — there is no
      // structured-output mode, so this is the model's text answer.
      if (typeof body.result !== 'string') {
        return {
          ok: false,
          kind: 'invalid',
          reason: 'response had no result',
        };
      }

      let raw: unknown;
      try {
        raw = JSON.parse(stripFence(body.result));
      } catch {
        return { ok: false, kind: 'invalid', reason: 'answer was not JSON' };
      }

      const usage = body.usage ?? {};
      return {
        ok: true,
        raw,
        // No field names the resolved model; the client falls back to the
        // configured string.
        model: null,
        // `inputTokens` **excludes** cache, so the three add up rather than
        // double-counting. Measured on two identical runs: the first billed
        // `{input: 14511, cacheRead: 4352}`, the second `{input: 15,
        // cacheRead: 18848}` — the whole prompt moved into the cache column
        // and out of the input one.
        promptTokens: sumTokens(
          usage.inputTokens,
          usage.cacheReadTokens,
          usage.cacheWriteTokens,
        ),
        completionTokens:
          typeof usage.outputTokens === 'number' ? usage.outputTokens : null,
      };
    }

    if (code !== 0) {
      return {
        ok: false,
        kind: 'transport',
        reason:
          firstLine(stderr) ||
          firstLine(stdout) ||
          `agent exited with code ${code}`,
      };
    }

    // Exited cleanly with no envelope: JSON that is simply not the envelope is
    // a usable process answering badly (`invalid`), anything else is a run that
    // never got as far as answering (`transport`).
    return {
      ok: false,
      kind: json.parsed ? 'invalid' : 'transport',
      reason: firstLine(stdout) || 'agent produced no output',
    };
  },

  parseAuth: (stdout) => {
    try {
      return (
        (JSON.parse(stdout) as { isAuthenticated?: unknown })
          .isAuthenticated === true
      );
    } catch {
      return false;
    }
  },
};
