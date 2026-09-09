import { claudeCodeAdapter } from './claude-code.adapter';
import { codexAdapter } from './codex.adapter';
import { cursorAdapter } from './cursor.adapter';
import { opencodeAdapter } from './opencode.adapter';

/**
 * Every agent CLI the app knows, in the order their cards appear. `AgentProvider`
 * is derived from it, so `AGENT_ADAPTERS` below fails to compile until a newly
 * listed CLI has an adapter file.
 *
 * Every value here must also be an `LlmProvider` — enforced by `isAgentProvider`,
 * whose narrowing is only legal while the two sets agree.
 */
export const AGENT_PROVIDERS = [
  'claude-code',
  'opencode',
  'cursor',
  'codex',
] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export interface AgentCliRequest {
  model: string;
  systemPrompt: string;
  /** JSON Schema (draft-7) produced from the caller's Zod schema. */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
}

export type AgentCliOutput =
  | {
      ok: true;
      raw: unknown;
      model: string | null;
      promptTokens: number | null;
      completionTokens: number | null;
    }
  | { ok: false; reason: string; kind: 'transport' | 'invalid' };

/**
 * One coding-agent CLI, normalized. The adapter **never spawns** — it only
 * builds argv and interprets what came back, which is what makes it pure and
 * testable against fixtures, and what makes another CLI one file.
 *
 * `parseOutput` splits `transport` (the CLI failed, is not logged in, exited
 * non-zero) from `invalid` (it ran fine and the body is unusable). The SDK
 * clients draw the same line, so the retry path stays correct: a malformed body
 * must never go back on the path meant for network faults.
 */
export interface AgentCliAdapter {
  /** Doubles as the `LlmProvider` value and the settings key prefix. */
  id: AgentProvider;
  displayName: string;
  /** Executable name looked up through the login shell. */
  binary: string;
  /** Shown on the card when the binary is missing. */
  installHint: string;
  /** Argv after the binary. The user prompt is always written to stdin. */
  buildArgs(req: AgentCliRequest): string[];
  /**
   * Complete stdin for CLIs that need the system prompt and schema in the
   * prompt body. Undefined writes the caller's user prompt unchanged.
   */
  stdin?(req: AgentCliRequest, userPrompt: string): string;
  /**
   * Scratch working directory for CLIs that discover project instructions.
   * The client creates it recursively before spawning.
   */
  workspaceDir?: string;
  /**
   * Files the CLI needs on disk before it runs, keyed by absolute path. The
   * client creates each parent directory and writes the content atomically,
   * after `workspaceDir`. It exists because codex takes its response schema as
   * `--output-schema <file>` and has no inline form; keep the paths
   * deterministic, because concurrent calls share this directory.
   */
  files?(req: AgentCliRequest): Record<string, string>;
  /**
   * Extra env for the child, merged over `process.env`. Undefined = argv is
   * enough. It exists because not every CLI is configured on argv: OpenCode
   * takes its system prompt *and* its tool policy as one inline JSON agent
   * definition in `OPENCODE_CONFIG_CONTENT`, with no flag for either.
   */
  env?(req: AgentCliRequest): Record<string, string>;
  /**
   * The CLI's own last word, dug out of stderr, for when stdout carries
   * nothing usable. Consulted on a timeout and when no event or envelope
   * arrived — a CLI that retries internally can go quiet for the whole
   * timeout, and then this is the only place the real reason exists.
   */
  stderrHint?(stderr: string): string | null;
  /** Turn the process result into a normalized answer. Never throws. */
  parseOutput(result: {
    code: number | null;
    stdout: string;
    stderr: string;
  }): AgentCliOutput;
  /** Argv that prints a version string on stdout. */
  versionArgs: string[];
  /** Optional login probe. Undefined = adapter has no separate login state. */
  authArgs?: string[];
  parseAuth?(stdout: string): boolean;
}

/**
 * Every adapter, keyed by its provider id. Exhaustive over `AgentProvider`, so
 * listing a CLI in `AGENT_PROVIDERS` without writing its adapter is a compile
 * error here.
 *
 * It lives beside the interface rather than in the barrel because the detector
 * reads it: a barrel that both re-exports the detector and is imported by it is
 * a require cycle whose correctness depends on statement ordering. The
 * back-edge to the adapter files is a value import, and they import only types
 * from here, so there is no cycle at runtime.
 */
export const AGENT_ADAPTERS: Record<AgentProvider, AgentCliAdapter> = {
  'claude-code': claudeCodeAdapter,
  opencode: opencodeAdapter,
  cursor: cursorAdapter,
  codex: codexAdapter,
};

/**
 * Takes a `string` rather than `LlmProvider` so nothing under `agents/` depends
 * on the provider enum at runtime — the dependency runs the other way. It
 * narrows an `LlmProvider` union at the call site all the same.
 *
 * `hasOwn` rather than `in`: every object inherits `toString`, and a provider
 * string reaches this from stored settings and from a request body.
 */
export const isAgentProvider = (p: string): p is AgentProvider =>
  Object.hasOwn(AGENT_ADAPTERS, p);
