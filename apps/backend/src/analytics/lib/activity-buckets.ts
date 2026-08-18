import type { CommitActivityGranularity } from '@launchstack/api-interfaces';

export class BucketLimitExceededError extends Error {
  constructor(limit: number) {
    super(`Bucket count exceeds the limit of ${limit}`);
    this.name = 'BucketLimitExceededError';
  }
}

interface CalendarDate {
  y: number;
  m: number;
  d: number;
}

/** Calendar date (YYYY-MM-DD) of an instant in a timezone. en-CA
 * locale formats as YYYY-MM-DD. */
export function dateKeyInTimeZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

function parseKey(key: string): CalendarDate {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

function toKey(c: CalendarDate): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(c.y, 4)}-${p(c.m)}-${p(c.d)}`;
}

/** Pure calendar arithmetic. The Date object is only a calendar
 * container here (UTC fields), so DST cannot affect the result. */
function addDays(c: CalendarDate, days: number): CalendarDate {
  const dt = new Date(Date.UTC(c.y, c.m - 1, c.d + days));
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function mondayOf(c: CalendarDate): CalendarDate {
  const weekday = new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay(); // 0=Sun
  return addDays(c, -((weekday + 6) % 7));
}

/**
 * Enumerates the bucket-start keys (YYYY-MM-DD) that Postgres
 * `date_trunc(granularity, ts AT TIME ZONE tz)` produces for instants in
 * the half-open interval [from, to). Used for app-side zero-fill, so the
 * keys MUST match the SQL truncation exactly: days are tz-local calendar
 * days; weeks start on ISO Monday.
 */
export function enumerateBucketKeys(
  from: Date,
  to: Date,
  granularity: CommitActivityGranularity,
  timeZone: string,
  maxBuckets = Number.POSITIVE_INFINITY,
): string[] {
  if (to.getTime() <= from.getTime()) return [];

  const step = granularity === 'week' ? 7 : 1;
  let cursor = parseKey(dateKeyInTimeZone(from, timeZone));
  if (granularity === 'week') cursor = mondayOf(cursor);

  // The last instant inside the interval determines the final bucket.
  const lastDate = parseKey(
    dateKeyInTimeZone(new Date(to.getTime() - 1), timeZone),
  );
  const lastKey = toKey(granularity === 'week' ? mondayOf(lastDate) : lastDate);

  const keys: string[] = [];
  let key = toKey(cursor);
  while (key <= lastKey) {
    if (keys.length >= maxBuckets) {
      throw new BucketLimitExceededError(maxBuckets);
    }
    keys.push(key);
    cursor = addDays(cursor, step);
    key = toKey(cursor);
  }
  return keys;
}
