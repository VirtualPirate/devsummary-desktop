/**
 * Calendar-grid arithmetic for the range picker. Every function here works on
 * `YYYY-MM-DD` keys and steps them with UTC-field `Date`s used purely as
 * containers, never by adding milliseconds to an instant: a local day is 23,
 * 24 or 25 hours, so `+ 86400000` skips or repeats a day twice a year.
 */

const pad = (n: number) => String(n).padStart(2, "0");

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function keyOf(y: number, m0: number, d: number): string {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}

/** A key is valid only if it round-trips: "2026-02-31" parses but is not a day. */
export function isDateKey(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_KEY_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return keyOf(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
}

/** Whole days from `a` to `b`, negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

export interface CalendarMonth {
  year: number;
  /** 0-indexed. */
  month: number;
  label: string;
  /** Rows of 7, Monday-first. `null` is a leading/trailing pad cell. */
  weeks: (string | null)[][];
}

export const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

/** `month` may be out of range (-1, 12); it normalizes like `Date.UTC` does. */
export function calendarMonth(year: number, month: number): CalendarMonth {
  const first = new Date(Date.UTC(year, month, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  const cells: (string | null)[] = Array<null>(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(keyOf(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return {
    year: y,
    month: m,
    label: new Date(Date.UTC(y, m, 1)).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    weeks,
  };
}

/** A resolved key only needs printing, so anchor at UTC midnight and format
 * in UTC. Anchoring at noon "to be safe" is off by one at +12 and beyond. */
export function formatDateKey(
  key: string,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    ...opts,
    timeZone: "UTC",
  });
}
