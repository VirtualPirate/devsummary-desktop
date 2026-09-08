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
 * A brief is "no activity" when generation finished and found zero commits.
 * Keyed on `generatedAt`, not on `status`: a brief that generated fine and then
 * failed to *send* is still a finished brief, and rows written before delivery
 * stopped overwriting `status` carry `failed` with a summary already stored.
 */
export function isNoActivityBrief(brief: BriefResponse): boolean {
  return !!brief.generatedAt && brief.commitCount === 0;
}

/**
 * `status: "failed"` is a *generation* verdict — no summary was ever written,
 * so there is nothing to show and regenerating is the only way forward.
 * Delivery failures leave `status` alone and only write `failureReason`, but
 * rows written before that fix carry `failed` over a perfectly good brief, so
 * `generatedAt` is what actually separates the two.
 */
export function isGenerationFailure(brief: BriefResponse): boolean {
  return brief.status === "failed" && !brief.generatedAt;
}

/**
 * A finished brief carrying a delivery failure — every channel down, or one of
 * two. Either way the brief itself is readable and the fix is re-delivery.
 */
export function hasDeliveryFailure(brief: BriefResponse): boolean {
  return !!brief.generatedAt && !!brief.failureReason;
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
