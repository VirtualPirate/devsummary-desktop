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
