import type { BriefResponse } from "@launchstack/api-interfaces";

const NO_ACTIVITY_TITLE_SUFFIX = " — no activity";

/**
 * A brief's `periodStart`/`periodEnd` are local midnights in the *schedule's*
 * timezone serialized as absolute instants, so they only read correctly when
 * formatted back in that zone — the viewer's zone moves the label a day. Pass
 * `timeZone: undefined` only for a period the viewer picked themselves (the
 * generate dialog), where their own zone is the right one.
 *
 * `periodEnd` is **exclusive** — the next local midnight — so the last day a
 * period covers is the instant before it. Every label below goes through
 * `lastCoveredInstant`; formatting `periodEnd` directly names a day the brief
 * does not cover.
 */
function lastCoveredInstant(endIso: string): Date {
  return new Date(new Date(endIso).getTime() - 1);
}

function sameCalendarDay(a: Date, b: Date, timeZone?: string): boolean {
  const opts = {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  } as const;
  return (
    a.toLocaleDateString("en-US", opts) === b.toLocaleDateString("en-US", opts)
  );
}

/** "Aug 7 – Aug 14", collapsing to one date when the period is a single day. */
export function formatRange(
  startIso: string,
  endIso: string,
  timeZone?: string,
): string {
  const start = new Date(startIso);
  const end = lastCoveredInstant(endIso);
  const opts = { month: "short", day: "numeric", timeZone } as const;
  const startStr = start.toLocaleDateString(undefined, opts);
  if (sameCalendarDay(start, end, timeZone)) return startStr;
  return `${startStr} – ${end.toLocaleDateString(undefined, opts)}`;
}

/** The same range with the year on the end date — the page/rail header form. */
export function formatPeriod(
  startIso: string,
  endIso: string,
  timeZone?: string,
): string {
  const start = new Date(startIso);
  const end = lastCoveredInstant(endIso);
  const endStr = end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
  if (sameCalendarDay(start, end, timeZone)) return endStr;
  const startStr = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone,
  });
  return `${startStr} – ${endStr}`;
}

/**
 * "Tue, Aug 4" from a report day key (`YYYY-MM-DD`). The key is *already* a
 * calendar date in the report's timezone, so it is read back as UTC and
 * formatted as UTC: converting it into any other zone is wrong in principle and
 * lands a day late for every zone at +12 or beyond.
 */
export function formatDayKey(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  },
): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}

/**
 * A brief is "no activity" when it reached a terminal status with zero commits.
 * Guarding on terminal status avoids mislabeling a brief that is still
 * generating — those also report commitCount: 0.
 */
export function isNoActivityBrief(brief: BriefResponse): boolean {
  return (
    (brief.status === "generated" || brief.status === "delivered") &&
    brief.commitCount === 0
  );
}

/**
 * The backend appends " — no activity" to the title of an empty brief
 * (generate-brief.handler.ts). Strip it so the UI can show a clean scope name
 * next to the dedicated badge. Falls back to the original title if absent.
 */
export function stripNoActivitySuffix(title: string): string {
  return title.endsWith(NO_ACTIVITY_TITLE_SUFFIX)
    ? title.slice(0, -NO_ACTIVITY_TITLE_SUFFIX.length)
    : title;
}
