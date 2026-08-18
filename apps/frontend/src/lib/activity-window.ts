import type { CommitActivityGranularity } from "@launchstack/api-interfaces";

export type ActivityRange = "7d" | "30d" | "90d" | "1y";

export const ACTIVITY_RANGES: ActivityRange[] = ["7d", "30d", "90d", "1y"];

export function isActivityRange(v: unknown): v is ActivityRange {
  return typeof v === "string" && (ACTIVITY_RANGES as string[]).includes(v);
}

const RANGE_CONFIG: Record<
  ActivityRange,
  { granularity: CommitActivityGranularity; buckets: number }
> = {
  "7d": { granularity: "day", buckets: 7 },
  "30d": { granularity: "day", buckets: 30 },
  "90d": { granularity: "day", buckets: 90 },
  "1y": { granularity: "week", buckets: 52 },
};

export interface ActivityWindow {
  /** Start of the previous-period half (request start). */
  requestFrom: Date;
  /** Start of the displayed half. */
  displayFrom: Date;
  /** Exclusive end: start of the bucket after the one containing `now`,
   * so the in-progress day/week is included. */
  to: Date;
  /** YYYY-MM-DD key of the first displayed bucket, for slicing points. */
  displayFromKey: string;
  granularity: CommitActivityGranularity;
  timezone: string;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfLocalISOWeek(d: Date): Date {
  const day = startOfLocalDay(d);
  const offset = (day.getDay() + 6) % 7; // 0 = Monday
  day.setDate(day.getDate() - offset);
  return day;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

export function dateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function computeActivityWindow(
  range: ActivityRange,
  now: Date = new Date(),
): ActivityWindow {
  const { granularity, buckets } = RANGE_CONFIG[range];
  const step = granularity === "week" ? 7 : 1;
  const currentBucketStart =
    granularity === "week" ? startOfLocalISOWeek(now) : startOfLocalDay(now);
  const to = addDays(currentBucketStart, step);
  const displayFrom = addDays(to, -buckets * step);
  const requestFrom = addDays(displayFrom, -buckets * step);
  return {
    requestFrom,
    displayFrom,
    to,
    displayFromKey: dateKey(displayFrom),
    granularity,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export interface PeriodDelta {
  pct: number | null; // null = no meaningful base (previous <= 0)
}

export function periodDelta(current: number, previous: number): PeriodDelta {
  return { pct: previous > 0 ? (current - previous) / previous : null };
}
