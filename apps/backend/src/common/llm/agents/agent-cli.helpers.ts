/**
 * What every adapter's `parseOutput` needs and none of them should own a copy
 * of. The rules here are about *interpreting a CLI's output in general* — what
 * counts as a first line, what a fenced answer is, how usage adds up. Anything
 * that encodes one CLI's field names stays in that CLI's adapter.
 *
 * The `jsonContractPrompt` below is the one that actually forced this file: it
 * is a contract the *model* reads, and two hand-kept copies of it drift without
 * anything failing to compile.
 *
 * Nothing here imports `agent-cli.adapter` — the adapters import *this*, and a
 * cycle back would be resolved as `any` in the type-aware lint pass, silently
 * unchecking every call site.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A scratch directory for one CLI to work in, so it never runs in the process
 * cwd — which in development is this repository, `AGENTS.md` and all. Every one
 * of these CLIs reads its working directory's instruction files into the model
 * prompt: measured on `claude`, the same tiny commit cost **25 062** input
 * tokens with cwd on the repo and **4 537** in an empty directory, 9.6 s
 * against 6.4 s.
 *
 * Under `DATA_DIR` rather than `tmpdir()`, and that is the security-relevant
 * half: on Linux `tmpdir()` is the shared `/tmp`, where a fixed path can be
 * pre-created — or symlinked elsewhere — by any other local user before we get
 * there. `mkdir(…, { recursive: true })` follows that symlink and succeeds, and
 * we would hand the CLI a directory of someone else's choosing. `DATA_DIR` is
 * the Electron `userData` folder, which is per user; the fallback is for
 * headless dev only, where `DATA_DIR` is unset.
 */
export const scratchDir = (name: string): string =>
  join(process.env.DATA_DIR ?? tmpdir(), name);

/**
 * SGR colour codes. Every one of these CLIs writes its errors coloured, and the
 * line becomes a `failure_reason` that is stored and shown on screen — a user
 * reading `\u001b[33m⚠ Warning: …` learns nothing from the escape. Measured on
 * Cursor's bad-credential path (`docs/receipts/AGENT-CLI-CURSOR.md` row 4b),
 * which shipped the raw codes until this moved here. The rule is disabled
 * rather than worked around: ESC *is* the character being matched.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * The first line matching `pattern`, else the first non-blank line, else ''.
 * Without a pattern this is "the first line of the trimmed text" — leading
 * blank lines are stripped either way. Colour codes are always stripped.
 */
export function firstLine(text: string, pattern?: RegExp): string {
  const lines = text
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    (pattern && lines.find((line) => pattern.test(line))) || lines[0] || ''
  );
}

/** ```` ```json … ``` ```` the model added despite being told not to. */
const FENCE = /^```[a-z]*\n?([\s\S]*?)\n?```$/i;

/** The body of a fenced block, or the text unchanged. Always trimmed. */
export function stripFence(text: string): string {
  const body = text.trim();
  return FENCE.exec(body)?.[1]?.trim() ?? body;
}

/**
 * Every balanced `{…}` span in `text`, outermost first, left to right. Quoted
 * braces do not count, because a preamble sentence can contain one and a JSON
 * string very often does.
 */
function* objectSpans(text: string): Generator<string> {
  for (
    let start = text.indexOf('{');
    start !== -1;
    start = text.indexOf('{', start + 1)
  ) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (char === '\\') i += 1;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          yield text.slice(start, i + 1);
          break;
        }
      }
    }
  }
}

/**
 * The model's answer as JSON, for the three CLIs that have no structured-output
 * mode and are only *asked* for JSON. Told "nothing before or after it" they
 * still narrate: Cursor's composer-2.5 answers `Exploring the workspace…\n{…}`
 * often enough to break a run outright, and a trailing "Hope this helps" is the
 * same failure from the other end. So the fence comes off, the whole body is
 * tried, and then each balanced object inside it — the first one that parses
 * wins, and the caller's Zod schema is still what decides whether it was the
 * answer.
 *
 * ponytail: O(n²) in the worst case (a body of nothing but `{`), on answers
 * that are a few KB. Scan once if a CLI ever streams something big through it.
 */
export function parseAnswerJson(
  text: string,
): { ok: true; value: unknown } | { ok: false } {
  const body = stripFence(text);
  for (const candidate of [body, ...objectSpans(body)]) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // Not JSON, or not the JSON — try the next candidate.
    }
  }
  return { ok: false };
}

export interface ParsedStdout {
  /** stdout was JSON at all — an array and a number count. */
  parsed: boolean;
  /** …and it was a plain object. Null for anything else, including an array. */
  object: Record<string, unknown> | null;
}

/**
 * Both facts, because adapters need them separately: `object` decides whether
 * there is an envelope to read, `parsed` decides whether a clean exit that
 * produced no envelope was a process answering badly (`invalid`) or one that
 * never got as far as answering (`transport`).
 */
export function parseStdout(stdout: string): ParsedStdout {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return { parsed: false, object: null };
  }
  return {
    parsed: true,
    object:
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null,
  };
}

/**
 * Whether this object is the CLI's result envelope rather than some other JSON
 * it happened to print: its own `type: 'result'` marker, or any of the fields
 * the adapter reads. `markers` are that adapter's field names.
 */
export const isEnvelope = (
  body: Record<string, unknown>,
  markers: readonly string[],
): boolean =>
  body.type === 'result' || markers.some((marker) => marker in body);

/** Null only when the envelope reported no usage at all. */
export function sumTokens(...values: unknown[]): number | null {
  const present = values.filter(
    (value): value is number => typeof value === 'number',
  );
  return present.length > 0
    ? present.reduce((total, value) => total + value, 0)
    : null;
}

/**
 * The JSON-only contract, for the CLIs that have no `--json-schema` flag and no
 * structured-output mode — the instruction *is* the schema enforcement, so it
 * is the only thing standing between a commit diff and prose in the database.
 *
 * One copy on purpose. OpenCode delivers it as an inline agent prompt and
 * Cursor prepends it to stdin, but they are quoting the same contract, and a
 * wording change that reaches only one of them is a silent quality regression
 * on the other.
 */
export const jsonContractPrompt = (req: {
  systemPrompt: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}): string =>
  `${req.systemPrompt}\n\nAnswer with exactly one JSON object matching the JSON Schema named ${req.schemaName} below — no markdown fences, no prose, nothing before or after it.\n${JSON.stringify(req.jsonSchema)}`;

/** The one field a JSON-lines event has to have for anything here to read it. */
export interface JsonLineEvent {
  type: string;
}

/**
 * stdout as JSON lines, one event per line — for the CLIs that stream events
 * rather than printing one envelope. Anything that is not an object with a
 * string `type` is dropped rather than failing the run: the stream is not
 * guaranteed to be JSON-only, and a progress notice on stdout must not cost
 * the answer printed after it.
 *
 * The caller names the event shape, because only it knows the CLI's fields.
 */
export function parseJsonLines<T extends JsonLineEvent>(stdout: string): T[] {
  const events: T[] = [];
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
      events.push(value as T);
    }
  }
  return events;
}

/** The stream is incremental, so the *last* event of a type is the real one. */
export const lastOfType = <T extends JsonLineEvent>(
  events: T[],
  type: string,
): T | undefined => events.filter((event) => event.type === type).at(-1);
