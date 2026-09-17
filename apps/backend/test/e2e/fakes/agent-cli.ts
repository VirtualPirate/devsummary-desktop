import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import {
  __execFileCalls,
  __setExecFile,
  type CliAnswer,
  type CliInvocation,
} from './child-process';

/** The `binary` field of each adapter. Cursor's is `agent`. */
export type AgentBinary = 'claude' | 'opencode' | 'agent' | 'codex';
export const AGENT_BINARIES: AgentBinary[] = [
  'claude',
  'opencode',
  'agent',
  'codex',
];

export interface AgentCliFake {
  calls: CliInvocation[];
  /** Put these binaries on PATH so `AgentCliDetector.locate()` finds them. */
  install(...binaries: AgentBinary[]): Promise<void>;
  uninstall(binary: AgentBinary): Promise<void>;
  /** The structured body this CLI's next runs answer with. */
  answer(binary: AgentBinary, body: unknown): void;
  /** Make this CLI's next runs fail the way the adapter has to interpret. */
  fail(binary: AgentBinary, over: Partial<CliAnswer>): void;
  teardown(): Promise<void>;
}

const VERSIONS: Record<AgentBinary, string> = {
  claude: '2.0.31 (Claude Code)',
  opencode: '1.1.53',
  agent: '2026.08.14-1a2b3c',
  codex: 'codex-cli 0.52.0',
};

/** Copied from the adapter unit fixtures, which are verbatim real stdout. */
const envelope = (binary: AgentBinary, body: unknown): string => {
  switch (binary) {
    case 'claude':
      return JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: JSON.stringify(body),
        structured_output: body,
        num_turns: 1,
        usage: {
          input_tokens: 4,
          cache_creation_input_tokens: 1200,
          cache_read_input_tokens: 300,
          output_tokens: 18,
        },
        modelUsage: {
          'claude-haiku-4-5-20251001': { inputTokens: 4, outputTokens: 18 },
        },
      });
    case 'agent':
      return JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: JSON.stringify(body),
        usage: {
          inputTokens: 13118,
          outputTokens: 99,
          cacheReadTokens: 5760,
          cacheWriteTokens: 0,
        },
      });
    case 'codex':
      return [
        JSON.stringify({ type: 'thread.started', thread_id: 'abc' }),
        JSON.stringify({ type: 'turn.started' }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'item_1',
            type: 'agent_message',
            text: JSON.stringify(body),
          },
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: {
            input_tokens: 18879,
            cached_input_tokens: 14115,
            output_tokens: 433,
          },
        }),
        '',
      ].join('\n');
    case 'opencode':
      return [
        JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }),
        JSON.stringify({
          type: 'text',
          part: { type: 'text', text: JSON.stringify(body) },
        }),
        JSON.stringify({
          type: 'step_finish',
          part: {
            type: 'step-finish',
            reason: 'stop',
            tokens: { input: 24704, output: 186 },
          },
        }),
        '',
      ].join('\n');
  }
};

const AUTH_OK: Record<AgentBinary, string> = {
  // Production `parseAuth` (not the brief's prose string): `claude auth status`
  // is JSON `{ loggedIn }`; Cursor's `agent status` is `{ isAuthenticated }`.
  claude: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }),
  agent: JSON.stringify({ isAuthenticated: true }),
  codex: 'Logged in using ChatGPT',
  // OpenCode has no `authArgs`; this is never asked for.
  opencode: '',
};

/**
 * The agent-CLI boundary, in two halves that have to agree:
 *
 * - **detection**: `AgentCliDetector.locate()` walks `process.env.PATH` with
 *   `access(X_OK)` before it falls back to a login-shell probe, so a temp
 *   directory of executable stub files prepended to PATH makes detection find a
 *   binary with no production change and no shell.
 * - **execution**: the `node:child_process` alias, so the file is never run.
 */
export async function installAgentCli(): Promise<AgentCliFake> {
  const dir = await mkdtemp(join(tmpdir(), 'devsummary-e2e-bin-'));
  const originalPath = process.env.PATH ?? '';
  // Isolate PATH to the stub dir. `locate()` uses `access(X_OK)` on every PATH
  // entry *before* `execFile`, so prepending over a machine that already has
  // `claude`/`opencode`/`agent`/`codex` would still find the real binaries.
  // The login-shell fallback is already answered "not found" by the stub.
  process.env.PATH = `${dir}${delimiter}`;

  const bodies = new Map<AgentBinary, unknown>();
  const failures = new Map<AgentBinary, Partial<CliAnswer>>();

  const binaryOf = (file: string): AgentBinary | null =>
    AGENT_BINARIES.find((b) => file.endsWith(`/${b}`)) ?? null;

  __setExecFile((call) => {
    const binary = binaryOf(call.file);
    if (!binary) {
      // `$SHELL -lic "command -v <binary>"` — the detector's fallback. Answering
      // "not found" keeps PATH the only thing that decides what is installed.
      return { code: 1, stdout: '', stderr: '' };
    }
    if (call.args.includes('--version')) {
      return { code: 0, stdout: `${VERSIONS[binary]}\n`, stderr: '' };
    }
    const isAuthProbe =
      (binary === 'claude' && call.args[0] === 'auth') ||
      (binary === 'codex' && call.args[0] === 'login') ||
      (binary === 'agent' && call.args[0] === 'status');
    if (isAuthProbe) {
      return { code: 0, stdout: `${AUTH_OK[binary]}\n`, stderr: '' };
    }

    const failure = failures.get(binary);
    if (failure) {
      return {
        code: failure.code ?? 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
        killed: failure.killed,
      };
    }
    return {
      code: 0,
      stdout: envelope(binary, bodies.get(binary) ?? { ok: true }),
      stderr: '',
    };
  });

  const write = async (binary: AgentBinary) => {
    const path = join(dir, binary);
    // Never executed — the alias intercepts every spawn. It only has to exist
    // and be X_OK, which is what `locate()` checks.
    await writeFile(path, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  };

  return {
    calls: __execFileCalls,
    install: async (...binaries) => {
      await mkdir(dir, { recursive: true });
      for (const binary of binaries) await write(binary);
    },
    uninstall: async (binary) => {
      await rm(join(dir, binary), { force: true });
    },
    answer: (binary, body) => {
      bodies.set(binary, body);
      failures.delete(binary);
    },
    fail: (binary, over) => {
      failures.set(binary, over);
    },
    teardown: async () => {
      __setExecFile(null);
      process.env.PATH = originalPath;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
