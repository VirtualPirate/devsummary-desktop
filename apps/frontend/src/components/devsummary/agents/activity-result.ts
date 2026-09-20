import type {
  CommitActivityPoint,
  CommitActivityResponse,
} from "@launchstack/api-interfaces";

/**
 * Parsing and labelling for the `activity_stats` tool result.
 *
 * Kept apart from the React renderer so `activity-result.check.ts` can run it
 * under plain node — the frontend has no test runner.
 */
export type ActivityToolResult =
  | { kind: "activity"; activity: CommitActivityResponse }
  | { kind: "error"; message: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A tool result reaches us in one of three shapes and we do not get to pick: the
 * tool answers with a JSON string, the adapter may hand it over already parsed,
 * and a message part built from content blocks arrives wrapped in
 * `{ content: [{ type: "text", text }] }`. Guessing one and casting is how the
 * chart would silently render nothing.
 */
function unwrap(result: unknown): unknown {
  if (typeof result === "string") return safeJson(result);
  if (isRecord(result) && Array.isArray(result.content)) {
    const text = result.content.find(
      (part) => isRecord(part) && part.type === "text",
    );
    return isRecord(text) && typeof text.text === "string"
      ? safeJson(text.text)
      : undefined;
  }
  return result;
}

function isPoint(value: unknown): value is CommitActivityPoint {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    typeof value.commits === "number" &&
    isRecord(value.byType)
  );
}

function isRange(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    typeof value.timezone === "string" &&
    (value.granularity === "day" || value.granularity === "week")
  );
}

export function parseActivityResult(result: unknown): ActivityToolResult {
  const payload = unwrap(result);

  // A refused window or a missing row comes back as `{ error: "..." }` rather
  // than a thrown tool call, so a failure arrives as a perfectly valid result.
  if (isRecord(payload) && typeof payload.error === "string") {
    return { kind: "error", message: payload.error };
  }
  if (
    isRecord(payload) &&
    Array.isArray(payload.points) &&
    payload.points.every(isPoint) &&
    isRange(payload.range)
  ) {
    return {
      kind: "activity",
      activity: payload as unknown as CommitActivityResponse,
    };
  }
  // Anything else — a plain error string, a truncated payload, a shape change.
  // Say so rather than drawing an empty chart.
  return {
    kind: "error",
    message: typeof result === "string" && result.length > 0 ? result : null,
  };
}

export function totalCommits(points: readonly CommitActivityPoint[]): number {
  return points.reduce((sum, point) => sum + point.commits, 0);
}

/**
 * "Aug 4 – Aug 17" in the range's own zone.
 *
 * `to` is exclusive (the analytics range is half-open), so the label formats
 * `to - 1ms` — otherwise it names a day the chart does not cover. The zone is
 * the response's, never the viewer's: these are instants resolved from local
 * midnights in that zone. See the Timezones rules in AGENTS.md (4 and 6).
 */
export function formatActivityRangeLabel(range: {
  from: string;
  to: string;
  timezone: string;
}): string {
  const format = (instant: number) =>
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      timeZone: range.timezone,
    }).format(new Date(instant));

  const from = Date.parse(range.from);
  const lastCovered = Date.parse(range.to) - 1;
  if (Number.isNaN(from) || Number.isNaN(lastCovered)) return "";

  const start = format(from);
  const end = format(lastCovered);
  return start === end ? start : `${start} – ${end}`;
}
