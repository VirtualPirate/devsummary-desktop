import { Injectable } from '@nestjs/common';

export interface CadenceScheduleLike {
  cadenceType: 'daily' | 'weekly' | 'monthly';
  cadenceTime: string;
  cadenceDayOfWeek?: number | null;
  cadenceDayOfMonth?: number | null;
  timezone: string;
}

/**
 * A period, **half-open**: `start` inclusive, `end` exclusive. `end` is the next
 * local midnight after the last covered day, never `23:59:59.999`.
 *
 * Inclusive ends did not tile. On a 25-hour fall-back day the repeated hour sat
 * between one window's `end` and the next window's `start`, so an hour of
 * commits landed in no brief at all. Half-open windows tile exactly because
 * consecutive windows derive their boundary from the *same* calendar key: one's
 * `end` and the next's `start` are literally the same expression.
 *
 * Two consequences, both easy to get wrong:
 * - commit queries bound the period with `<`, never `<=`;
 * - anything that *labels* a period formats `end - 1ms`, or it names a day the
 *   brief does not cover (see `formatPeriodLabel`).
 */
export interface PeriodWindow {
  start: Date;
  end: Date;
}

/*
 * Calendar helpers. A wall clock here is a `YYYY-MM-DD` calendar date plus
 * hours/minutes, and it is resolved against the target zone through `Intl`
 * only — never by fabricating a `new Date(y, m, d, h, m)`, which is built in the
 * SERVER's zone: a wall clock landing in the server's own DST gap is silently
 * normalized an hour forward before anything reads it (a schedule fires late; a
 * period loses its first hour). date-fns-tz is not a way out — `toZonedTime`,
 * `formatInTimeZone` and the Date form of `fromZonedTime` all round-trip
 * through exactly that local-Date step, and even the string form of
 * `fromZonedTime` probes the offset via the server's fields, so it breaks
 * ambiguous fall-back times apart differently per server zone.
 *
 * Date objects below are calendar containers only, addressed through their UTC
 * fields, where no DST exists.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const pad2 = (n: number) => String(n).padStart(2, '0');

// Formatter construction dominates the cost of everything here, and backfill
// tiles hundreds of windows per schedule.
const partsFormatters = new Map<string, Intl.DateTimeFormat>();
const labelFormatters = new Map<string, Intl.DateTimeFormat>();

function cached(
  cache: Map<string, Intl.DateTimeFormat>,
  key: string,
  build: () => Intl.DateTimeFormat,
): Intl.DateTimeFormat {
  const hit = cache.get(key);
  if (hit) return hit;
  const dtf = build();
  cache.set(key, dtf);
  return dtf;
}

/**
 * The wall clock of an instant in a timezone, as `YYYY-MM-DDTHH:mm:ss`. `en-CA`
 * formats dates as `YYYY-MM-DD` (the same trick as
 * `analytics/lib/activity-buckets.ts`), and `Intl` reads the zone directly, so
 * no server-local Date exists to be rewritten.
 */
function wallClockIn(instant: Date, tz: string): string {
  const dtf = cached(
    partsFormatters,
    tz,
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
  );
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** The calendar date of an instant in a timezone, as `YYYY-MM-DD`. */
function dateKeyIn(instant: Date, tz: string): string {
  return wallClockIn(instant, tz).slice(0, 10);
}

/** The zone's UTC offset in ms (east positive) at an instant. */
function offsetAt(instant: Date, tz: string): number {
  const wallAsUtc = Date.parse(`${wallClockIn(instant, tz)}Z`);
  // Both sides floored to the second, since a wall clock carries no ms.
  return wallAsUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

const keyToUtc = (key: string): Date => new Date(`${key}T00:00:00Z`);
const utcToKey = (d: Date): string => d.toISOString().slice(0, 10);

function shiftDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** Calendar-month shift on UTC fields, clamping the day to the target month's
 * length (Jan 31 + 1 month = Feb 28), keeping the time of day. */
function shiftMonthsUtc(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  out.setUTCDate(Math.min(day, daysInMonthUtc(out)));
  return out;
}

function daysInMonthUtc(d: Date): number {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

const addDaysKey = (key: string, days: number): string =>
  utcToKey(shiftDaysUtc(keyToUtc(key), days));

const addMonthsKey = (key: string, months: number): string =>
  utcToKey(shiftMonthsUtc(keyToUtc(key), months));

/** ISO week start (Mon = 1 … Sun = 7) of the week containing `key`. */
const mondayKey = (key: string): string =>
  addDaysKey(key, -((keyToUtc(key).getUTCDay() + 6) % 7));

/** JS `getDay()` semantics: Sun = 0 … Sat = 6. */
const weekdayOfKey = (key: string): number => keyToUtc(key).getUTCDay();

const monthStartKey = (key: string): string => `${key.slice(0, 7)}-01`;
const monthEndKey = (key: string): string =>
  `${key.slice(0, 7)}-${pad2(daysInMonthUtc(keyToUtc(key)))}`;
const daysInMonthKey = (key: string): number => daysInMonthUtc(keyToUtc(key));
const withDay = (key: string, day: number): string =>
  `${key.slice(0, 7)}-${pad2(day)}`;

/**
 * The smallest instant in `(lo, hi]` whose UTC offset is `target` — i.e. the DST
 * transition bounded by those two. tzdata transitions land on whole minutes, so
 * the search steps minutes and finishes in ~6 probes.
 *
 * If no instant in the range carries `target` the upper bound is returned, which
 * is the later of the two candidate resolutions.
 */
function transitionBetween(
  lo: number,
  hi: number,
  target: number,
  tz: string,
): Date {
  let low = Math.floor(lo / MINUTE_MS) + 1;
  const high0 = Math.ceil(hi / MINUTE_MS);
  let high = high0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (offsetAt(new Date(mid * MINUTE_MS), tz) === target) high = mid;
    else low = mid + 1;
  }
  return new Date(low * MINUTE_MS);
}

/**
 * The instant of a wall clock on a calendar date, in a timezone. Two passes:
 * probe the offset, apply it, and re-probe in case the first probe sat on the
 * other side of a transition.
 *
 * A wall clock inside a spring-forward gap does not exist, and neither offset
 * reads back. The answer is then **the transition instant itself** — the first
 * moment that does exist at or after the time asked for. That is what both
 * callers want, and they want the same thing: for a day boundary it is the first
 * instant of the local day, for a schedule time the first moment it can fire.
 *
 * Resolving a gap by simply picking one of the two offsets is wrong in both
 * directions. The larger lands an hour BEFORE the gap, on the previous local
 * day — which drew the boundary of a day whose midnight does not exist
 * (Africa/Cairo, America/Havana, Asia/Beirut, Atlantic/Azores, America/Santiago)
 * an hour early and filed that day's last hour under the next day's brief. The
 * smaller overshoots past the transition by the length of the gap, so a 02:30
 * schedule in a 02:00–03:00 gap would fire at 03:30 rather than 03:00.
 */
function zonedInstant(
  dateKey: string,
  tz: string,
  h = 0,
  m = 0,
  s = 0,
  ms = 0,
): Date {
  const wallAsUtc = Date.parse(
    `${dateKey}T${pad2(h)}:${pad2(m)}:${pad2(s)}.${String(ms).padStart(3, '0')}Z`,
  );
  const first = offsetAt(new Date(wallAsUtc), tz);
  const second = offsetAt(new Date(wallAsUtc - first), tz);
  if (second === first) return new Date(wallAsUtc - first);
  const third = offsetAt(new Date(wallAsUtc - second), tz);
  if (third === second) return new Date(wallAsUtc - second);
  // Gap. Spring forward means the offset grows, so the larger one is the
  // post-transition side: resolving with it sits before the transition, with
  // the smaller one at or after it, and the transition is between the two.
  const post = Math.max(second, third);
  return transitionBetween(
    wallAsUtc - post,
    wallAsUtc - Math.min(second, third),
    post,
    tz,
  );
}

/**
 * The first instant of a local calendar day — normally local midnight, and the
 * transition itself in a zone that springs forward at 00:00.
 *
 * Exported because `BriefReportService` tiles the same days for the report and
 * has to resolve them *identically*: it used `date-fns-tz`'s `fromZonedTime`,
 * which resolves a nonexistent midnight to the hour before the gap, so the
 * report's last day ended an hour before the brief's own period did and dropped
 * that hour of commits from the final column.
 */
export const zonedStartOfDay = (dateKey: string, tz: string): Date =>
  zonedInstant(dateKey, tz);

const startOfDay = zonedStartOfDay;

/**
 * The exclusive end of a period whose last covered day is `dateKey`: local
 * midnight of the NEXT calendar date.
 *
 * Derived from the calendar key, not by adding 24 hours (or a millisecond) to
 * anything — a local day is 23 or 25 hours across a DST change, and the whole
 * point is that this is byte-identical to `startOfDay` of that next key, which
 * is what the following window uses as its `start`.
 */
const endOfDayExclusive = (dateKey: string, tz: string): Date =>
  startOfDay(addDaysKey(dateKey, 1), tz);

@Injectable()
export class CadenceService {
  computeNextRunAt(schedule: CadenceScheduleLike, fromInstant: Date): Date {
    switch (schedule.cadenceType) {
      case 'daily':
        return this.computeDailyNext(schedule, fromInstant);
      case 'weekly':
        return this.computeWeeklyNext(schedule, fromInstant);
      case 'monthly':
        return this.computeMonthlyNext(schedule, fromInstant);
    }
  }

  computePeriod(schedule: CadenceScheduleLike, firingAt: Date): PeriodWindow {
    const tz = schedule.timezone;
    const today = dateKeyIn(firingAt, tz);
    switch (schedule.cadenceType) {
      case 'daily': {
        const prev = addDaysKey(today, -1);
        return {
          start: startOfDay(prev, tz),
          end: endOfDayExclusive(prev, tz),
        };
      }
      case 'weekly': {
        // ISO weeks: the period is last week, Mon through Sun.
        const thisWeekMonday = mondayKey(today);
        return {
          start: startOfDay(addDaysKey(thisWeekMonday, -7), tz),
          end: endOfDayExclusive(addDaysKey(thisWeekMonday, -1), tz),
        };
      }
      case 'monthly': {
        const prevMonthStart = addMonthsKey(monthStartKey(today), -1);
        return {
          start: startOfDay(prevMonthStart, tz),
          end: endOfDayExclusive(monthEndKey(prevMonthStart), tz),
        };
      }
    }
  }

  /**
   * The aligned period window (day / Mon–Sun week / calendar month) that
   * CONTAINS the given instant — used for backfilling historical briefs.
   * Alignment mirrors computePeriod and is independent of cadenceTime /
   * cadenceDayOfWeek / cadenceDayOfMonth (those only affect firing time).
   */
  windowContaining(schedule: CadenceScheduleLike, instant: Date): PeriodWindow {
    const tz = schedule.timezone;
    const today = dateKeyIn(instant, tz);
    switch (schedule.cadenceType) {
      case 'daily': {
        return {
          start: startOfDay(today, tz),
          end: endOfDayExclusive(today, tz),
        };
      }
      case 'weekly': {
        const monday = mondayKey(today);
        return {
          start: startOfDay(monday, tz),
          end: endOfDayExclusive(addDaysKey(monday, 6), tz),
        };
      }
      case 'monthly': {
        return {
          start: startOfDay(monthStartKey(today), tz),
          end: endOfDayExclusive(monthEndKey(today), tz),
        };
      }
    }
  }

  /**
   * The earliest instant backfill should look back to when discovering a
   * schedule's commits — `maxWindows` cadence periods before `from`. This
   * bounds backfill to at most `maxWindows` windows for every cadence and
   * replaces a fixed one-year floor that silently skipped any repository
   * whose most recent activity predated the last calendar year.
   */
  backfillLookbackStart(
    schedule: Pick<CadenceScheduleLike, 'cadenceType'>,
    from: Date,
    maxWindows: number,
  ): Date {
    switch (schedule.cadenceType) {
      case 'daily':
        return shiftDaysUtc(from, -maxWindows);
      case 'weekly':
        return shiftDaysUtc(from, -7 * maxWindows);
      case 'monthly':
        return shiftMonthsUtc(from, -maxWindows);
    }
  }

  /**
   * Backfill lookback expressed in calendar months regardless of cadence — the
   * unit the create form asks the user for. `0` yields `from`, i.e. no history.
   */
  lookbackStartFromMonths(from: Date, months: number): Date {
    return shiftMonthsUtc(from, -months);
  }

  windowsInRange(
    schedule: CadenceScheduleLike,
    rangeStart: Date,
    rangeEnd: Date,
  ): PeriodWindow[] {
    const windows: PeriodWindow[] = [];
    if (rangeEnd.getTime() <= rangeStart.getTime()) return windows;
    let current = this.windowContaining(schedule, rangeStart);
    while (current.start.getTime() < rangeEnd.getTime()) {
      windows.push(current);
      // Windows are half-open, so `current.end` IS the next window's start.
      // Probe it directly — the old `+ 1` was there to escape an inclusive end
      // and now only pushes the probe past the boundary it is looking for.
      let probe = current.end.getTime();
      let next = this.windowContaining(schedule, new Date(probe));
      // Forward progress is still not free: in a zone whose DST fall-back lands
      // on midnight (America/Santiago, America/Nuuk, America/Scoresbysund)
      // local 00:00 happens twice, so a boundary instant can still read as the
      // earlier local day and this loop would spin forever, pushing the same
      // window until the process runs out of memory. Step the probe on instead.
      while (next.start.getTime() <= current.start.getTime()) {
        probe += HOUR_MS;
        next = this.windowContaining(schedule, new Date(probe));
      }
      current = next;
    }
    return windows;
  }

  /**
   * e.g. `Aug 3 – Aug 9, 2026`, in the schedule's timezone.
   *
   * The end is formatted as `end - 1ms`: `period.end` is exclusive (the next
   * local midnight), so formatting it verbatim names a day the brief does not
   * cover and every label gains a day.
   */
  formatPeriodLabel(period: PeriodWindow, tz: string): string {
    const day = cached(
      labelFormatters,
      tz,
      () =>
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          month: 'short',
          day: 'numeric',
        }),
    );
    const dayAndYear = cached(
      labelFormatters,
      `${tz}|y`,
      () =>
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
    );
    const lastCovered = new Date(period.end.getTime() - 1);
    return `${day.format(period.start)} – ${dayAndYear.format(lastCovered)}`;
  }

  private parseHhmm(time: string): { h: number; m: number } {
    const [h, m] = time.split(':').map(Number);
    return { h, m };
  }

  /**
   * `zonedInstant` already resolves a spring-forward gap to the transition —
   * the first local time that exists at or after the one asked for — so a
   * schedule set to a time that does not exist on a given day fires as soon as
   * it can. This used to round the instant up to the next whole UTC hour to
   * approximate that, which overshot in any zone whose transition is not on the
   * hour (Australia/Lord_Howe moves by 30 minutes).
   */
  private resolveLocalToUtc(
    dateKey: string,
    h: number,
    m: number,
    tz: string,
  ): Date {
    return zonedInstant(dateKey, tz, h, m);
  }

  private computeDailyNext(schedule: CadenceScheduleLike, from: Date): Date {
    const tz = schedule.timezone;
    const { h, m } = this.parseHhmm(schedule.cadenceTime);
    const today = dateKeyIn(from, tz);
    let candidate = this.resolveLocalToUtc(today, h, m, tz);
    if (candidate.getTime() <= from.getTime()) {
      candidate = this.resolveLocalToUtc(addDaysKey(today, 1), h, m, tz);
    }
    return candidate;
  }

  private computeWeeklyNext(schedule: CadenceScheduleLike, from: Date): Date {
    const tz = schedule.timezone;
    const { h, m } = this.parseHhmm(schedule.cadenceTime);
    const targetDow = schedule.cadenceDayOfWeek ?? 0; // JS getDay: Sun = 0
    const today = dateKeyIn(from, tz);
    const daysAhead = (targetDow - weekdayOfKey(today) + 7) % 7;
    let candidate = this.resolveLocalToUtc(
      addDaysKey(today, daysAhead),
      h,
      m,
      tz,
    );
    if (candidate.getTime() <= from.getTime()) {
      candidate = this.resolveLocalToUtc(
        addDaysKey(today, daysAhead + 7),
        h,
        m,
        tz,
      );
    }
    return candidate;
  }

  private computeMonthlyNext(schedule: CadenceScheduleLike, from: Date): Date {
    const tz = schedule.timezone;
    const { h, m } = this.parseHhmm(schedule.cadenceTime);
    const desiredDay = schedule.cadenceDayOfMonth ?? 1;
    const today = dateKeyIn(from, tz);

    const tryMonth = (monthKey: string): Date => {
      const clampedDay = Math.min(desiredDay, daysInMonthKey(monthKey));
      return this.resolveLocalToUtc(withDay(monthKey, clampedDay), h, m, tz);
    };

    let candidate = tryMonth(today);
    if (candidate.getTime() <= from.getTime()) {
      candidate = tryMonth(addMonthsKey(today, 1));
    }
    return candidate;
  }
}
