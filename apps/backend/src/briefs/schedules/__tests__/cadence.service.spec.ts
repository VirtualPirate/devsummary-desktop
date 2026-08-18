import { CadenceService } from '../services/cadence.service';

const svc = new CadenceService();

describe('CadenceService.computeNextRunAt', () => {
  it('daily — same time tomorrow when current time has passed', () => {
    const next = svc.computeNextRunAt(
      { cadenceType: 'daily', cadenceTime: '16:00', timezone: 'UTC' },
      new Date('2026-05-26T16:00:00Z'),
    );
    expect(next.toISOString()).toBe('2026-05-27T16:00:00.000Z');
  });

  it('daily — handles non-UTC timezone', () => {
    // 09:00 America/New_York = 13:00 UTC (EDT, summer)
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'daily',
        cadenceTime: '09:00',
        timezone: 'America/New_York',
      },
      new Date('2026-05-26T09:00:00Z'),
    );
    expect(next.toISOString()).toBe('2026-05-26T13:00:00.000Z');
  });

  it('weekly — next occurrence of dayOfWeek', () => {
    // 2026-05-26 is a Tuesday (dayOfWeek = 2). Friday = 5.
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'weekly',
        cadenceTime: '12:00',
        cadenceDayOfWeek: 5,
        timezone: 'UTC',
      },
      new Date('2026-05-26T12:00:00Z'),
    );
    expect(next.toISOString()).toBe('2026-05-29T12:00:00.000Z');
  });

  it('weekly — same day later this week if time has not passed', () => {
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'weekly',
        cadenceTime: '18:00',
        cadenceDayOfWeek: 2,
        timezone: 'UTC',
      },
      new Date('2026-05-26T09:00:00Z'),
    );
    expect(next.toISOString()).toBe('2026-05-26T18:00:00.000Z');
  });

  it('monthly — next occurrence of dayOfMonth', () => {
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'monthly',
        cadenceTime: '08:00',
        cadenceDayOfMonth: 1,
        timezone: 'UTC',
      },
      new Date('2026-05-26T00:00:00Z'),
    );
    expect(next.toISOString()).toBe('2026-06-01T08:00:00.000Z');
  });

  it('monthly — clamps day 31 to end of February', () => {
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'monthly',
        cadenceTime: '00:00',
        cadenceDayOfMonth: 31,
        timezone: 'UTC',
      },
      new Date('2027-01-31T01:00:00Z'),
    );
    expect(next.toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });

  it('monthly — clamps day 31 to Feb 29 in a leap year', () => {
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'monthly',
        cadenceTime: '00:00',
        cadenceDayOfMonth: 31,
        timezone: 'UTC',
      },
      new Date('2028-01-31T01:00:00Z'),
    );
    expect(next.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('DST spring-forward in America/New_York rounds forward', () => {
    // 2026 DST in US starts on Sunday 2026-03-08; clocks jump 02:00 → 03:00 local.
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'daily',
        cadenceTime: '02:30',
        timezone: 'America/New_York',
      },
      new Date('2026-03-07T07:30:00Z'),
    );
    expect(next.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });
});

describe('CadenceService.computePeriod', () => {
  it('daily — previous full local day', () => {
    const period = svc.computePeriod(
      { cadenceType: 'daily', cadenceTime: '16:00', timezone: 'UTC' },
      new Date('2026-05-26T16:00:00Z'),
    );
    expect(period.start.toISOString()).toBe('2026-05-25T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-05-26T00:00:00.000Z');
  });

  it('weekly — previous Monday through Sunday in tz', () => {
    const period = svc.computePeriod(
      {
        cadenceType: 'weekly',
        cadenceTime: '09:00',
        cadenceDayOfWeek: 1,
        timezone: 'UTC',
      },
      new Date('2026-06-01T09:00:00Z'),
    );
    expect(period.start.toISOString()).toBe('2026-05-25T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('monthly — previous calendar month', () => {
    const period = svc.computePeriod(
      {
        cadenceType: 'monthly',
        cadenceTime: '08:00',
        cadenceDayOfMonth: 1,
        timezone: 'UTC',
      },
      new Date('2026-06-01T08:00:00Z'),
    );
    expect(period.start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('CadenceService.windowContaining', () => {
  it('daily — returns the calendar day containing the instant (UTC)', () => {
    const w = svc.windowContaining(
      { cadenceType: 'daily', cadenceTime: '00:00', timezone: 'UTC' },
      new Date('2026-05-20T13:45:00Z'),
    );
    expect(w.start.toISOString()).toBe('2026-05-20T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-05-21T00:00:00.000Z');
  });

  it('weekly — returns the Mon–Sun week containing the instant', () => {
    // 2026-05-20 is a Wednesday; that ISO week is Mon 2026-05-18 .. Sun 2026-05-24.
    const w = svc.windowContaining(
      {
        cadenceType: 'weekly',
        cadenceTime: '00:00',
        cadenceDayOfWeek: 1,
        timezone: 'UTC',
      },
      new Date('2026-05-20T13:45:00Z'),
    );
    expect(w.start.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-05-25T00:00:00.000Z');
  });

  it('weekly — Sunday belongs to the week that started the previous Monday', () => {
    const w = svc.windowContaining(
      {
        cadenceType: 'weekly',
        cadenceTime: '00:00',
        cadenceDayOfWeek: 1,
        timezone: 'UTC',
      },
      new Date('2026-05-24T10:00:00Z'), // Sunday
    );
    expect(w.start.toISOString()).toBe('2026-05-18T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-05-25T00:00:00.000Z');
  });

  it('monthly — returns the calendar month containing the instant', () => {
    const w = svc.windowContaining(
      {
        cadenceType: 'monthly',
        cadenceTime: '00:00',
        cadenceDayOfMonth: 1,
        timezone: 'UTC',
      },
      new Date('2026-02-15T12:00:00Z'),
    );
    expect(w.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('daily — respects timezone boundaries', () => {
    // 2026-05-20T02:00Z is still 2026-05-19 (22:00) in America/New_York.
    const w = svc.windowContaining(
      {
        cadenceType: 'daily',
        cadenceTime: '00:00',
        timezone: 'America/New_York',
      },
      new Date('2026-05-20T02:00:00Z'),
    );
    // Local day 2026-05-19 00:00 EDT = 2026-05-19T04:00Z.
    expect(w.start.toISOString()).toBe('2026-05-19T04:00:00.000Z');
  });
});

describe('CadenceService.windowsInRange', () => {
  it('daily — returns one window per calendar day in range', () => {
    const windows = svc.windowsInRange(
      { cadenceType: 'daily', cadenceTime: '00:00', timezone: 'UTC' },
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-04T00:00:00Z'), // exclusive
    );
    expect(windows).toHaveLength(3);
    expect(windows[0].start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(windows[0].end.toISOString()).toBe('2026-06-02T00:00:00.000Z');
    expect(windows[2].start.toISOString()).toBe('2026-06-03T00:00:00.000Z');
  });

  it('weekly — returns one window per ISO week in range', () => {
    // 2026-06-01 is a Monday, so week = Mon 2026-06-01 – Sun 2026-06-07.
    // rangeEnd = 2026-06-08 (the next Monday) is exclusive → 1 week returned.
    const windows = svc.windowsInRange(
      {
        cadenceType: 'weekly',
        cadenceTime: '00:00',
        cadenceDayOfWeek: 1,
        timezone: 'UTC',
      },
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-08T00:00:00Z'),
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(windows[0].end.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('weekly — includes multiple weeks when range spans them', () => {
    const windows = svc.windowsInRange(
      {
        cadenceType: 'weekly',
        cadenceTime: '00:00',
        cadenceDayOfWeek: 1,
        timezone: 'UTC',
      },
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-15T00:00:00Z'),
    );
    expect(windows).toHaveLength(2);
    expect(windows[0].start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(windows[1].start.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('monthly — returns one window per calendar month in range', () => {
    const windows = svc.windowsInRange(
      {
        cadenceType: 'monthly',
        cadenceTime: '00:00',
        cadenceDayOfMonth: 1,
        timezone: 'UTC',
      },
      new Date('2026-04-01T00:00:00Z'),
      new Date('2026-07-01T00:00:00Z'), // exclusive
    );
    expect(windows).toHaveLength(3);
    expect(windows[0].start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(windows[1].start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(windows[2].start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('returns empty array when rangeEnd <= rangeStart', () => {
    const windows = svc.windowsInRange(
      { cadenceType: 'daily', cadenceTime: '00:00', timezone: 'UTC' },
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T00:00:00Z'), // equal → empty
    );
    expect(windows).toHaveLength(0);
  });

  it('terminates in a zone whose DST fall-back lands on midnight', () => {
    // America/Santiago winds back at 2026-04-05 00:00 local, so local midnight
    // happens twice and a boundary instant can still read as the earlier local
    // day. Without a forward-progress guard this pushes the same window forever
    // until the worker runs out of memory — so a regression here hangs the
    // suite rather than failing an assertion.
    const windows = svc.windowsInRange(
      {
        cadenceType: 'daily',
        cadenceTime: '00:00',
        timezone: 'America/Santiago',
      },
      new Date('2026-04-02T00:00:00Z'),
      new Date('2026-04-08T00:00:00Z'),
    );
    // One window per local day, 2026-04-01 (the containing one) through
    // 2026-04-07, including the 25-hour 2026-04-04.
    expect(windows.map((w) => w.start.toISOString())).toEqual([
      '2026-04-01T03:00:00.000Z',
      '2026-04-02T03:00:00.000Z',
      '2026-04-03T03:00:00.000Z',
      '2026-04-04T03:00:00.000Z',
      '2026-04-05T04:00:00.000Z',
      '2026-04-06T04:00:00.000Z',
      '2026-04-07T04:00:00.000Z',
    ]);
  });

  // The residual the half-open change exists to close. With an inclusive
  // `23:59:59.999` end, 2026-04-04 in Santiago ran to 2026-04-05T02:59:59.999Z
  // while the next window started at 04:00:00Z — the repeated 23:00–24:00 local
  // hour (03:00–04:00Z) sat between them and landed in no brief at all.
  it('tiles a 25-hour fall-back day with no gap and no overlap', () => {
    const windows = svc.windowsInRange(
      {
        cadenceType: 'daily',
        cadenceTime: '00:00',
        timezone: 'America/Santiago',
      },
      new Date('2026-04-02T00:00:00Z'),
      new Date('2026-04-08T00:00:00Z'),
    );

    for (let i = 1; i < windows.length; i++) {
      // Not "greater than": exactly equal. A gap of even 1ms is a commit that
      // can fall through, and an overlap double-counts one.
      expect(windows[i].start.getTime()).toBe(windows[i - 1].end.getTime());
    }

    const fallBack = windows.find(
      (w) => w.start.toISOString() === '2026-04-04T03:00:00.000Z',
    );
    expect(fallBack?.end.toISOString()).toBe('2026-04-05T04:00:00.000Z');
    expect(
      (fallBack as { start: Date; end: Date }).end.getTime() -
        (fallBack as { start: Date; end: Date }).start.getTime(),
    ).toBe(25 * 60 * 60 * 1000);

    // Seven local days that include one 25-hour day = 169 hours of elapsed
    // time, all of it covered by exactly one window.
    const elapsed =
      windows[windows.length - 1].end.getTime() - windows[0].start.getTime();
    expect(elapsed).toBe(169 * 60 * 60 * 1000);
    expect(
      windows.reduce((n, w) => n + (w.end.getTime() - w.start.getTime()), 0),
    ).toBe(elapsed);
  });

  it('rangeStart mid-window still includes that window', () => {
    // rangeStart is 12:00 on June 1; the containing window starts at 00:00 June 1,
    // which is < rangeEnd (June 3 00:00). Both June 1 and June 2 are included.
    const windows = svc.windowsInRange(
      { cadenceType: 'daily', cadenceTime: '00:00', timezone: 'UTC' },
      new Date('2026-06-01T12:00:00Z'),
      new Date('2026-06-03T00:00:00Z'),
    );
    expect(windows).toHaveLength(2);
    expect(windows[0].start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(windows[1].start.toISOString()).toBe('2026-06-02T00:00:00.000Z');
  });
});

/**
 * A window must be exactly the set of instants whose local date is that day.
 * Where midnight does not exist — a zone that springs forward AT 00:00 — the
 * old resolution picked the offset that landed an *hour before the gap*, i.e.
 * on the previous local day, so the day started (and the one before it ended)
 * an hour early and that hour of commits was filed under the wrong brief.
 */
describe('CadenceService on a day whose local midnight does not exist', () => {
  const daily = (timezone: string) => ({
    cadenceType: 'daily' as const,
    cadenceTime: '00:00',
    timezone,
  });

  it.each([
    // zone, the day that has no 00:00, the first instant that day does have
    ['Africa/Cairo', '2026-04-24', '2026-04-23T22:00:00.000Z'],
    ['America/Santiago', '2026-09-06', '2026-09-06T04:00:00.000Z'],
    ['Asia/Beirut', '2026-03-29', '2026-03-28T22:00:00.000Z'],
  ])(
    '%s %s starts at the transition, not an hour before it',
    (tz, day, want) => {
      const w = svc.windowContaining(daily(tz), new Date(`${day}T12:00:00Z`));
      expect(w.start.toISOString()).toBe(want);

      // The defining property, pinned from both sides: the first instant is on
      // this local day and the one before it is not.
      const localDate = (d: Date) =>
        d.toLocaleDateString('en-CA', { timeZone: tz });
      expect(localDate(w.start)).toBe(day);
      expect(localDate(new Date(w.start.getTime() - 1))).not.toBe(day);
      expect(localDate(new Date(w.end.getTime() - 1))).toBe(day);
      expect(localDate(w.end)).not.toBe(day);
    },
  );

  it('hands the previous day its full last hour', () => {
    // Cairo Apr 23 is a normal 24-hour day; its end used to be cut to 21:00Z
    // (23:00 local), so 23:00–24:00 local landed in Apr 24's brief.
    const w = svc.windowContaining(
      daily('Africa/Cairo'),
      new Date('2026-04-23T12:00:00Z'),
    );
    expect(w.start.toISOString()).toBe('2026-04-22T22:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-04-23T22:00:00.000Z');
    expect(w.end.getTime() - w.start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('fires a schedule at the first time that exists, not the next whole hour', () => {
    // Australia/Lord_Howe springs forward by 30 minutes (02:00 → 02:30), so
    // rounding up to the next whole hour overshot the first valid time.
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'daily',
        cadenceTime: '02:15',
        timezone: 'Australia/Lord_Howe',
      },
      new Date('2026-10-03T00:00:00Z'),
    );
    expect(
      next.toLocaleString('en-CA', {
        timeZone: 'Australia/Lord_Howe',
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      }),
    ).toBe('02:30');
  });
});

describe('CadenceService.formatPeriodLabel', () => {
  // A label names the last day the brief COVERS, so it formats `end - 1ms`.
  // Formatting the exclusive end verbatim adds a day to every label.
  it('labels the last covered day, not the exclusive end', () => {
    const period = svc.computePeriod(
      {
        cadenceType: 'weekly',
        cadenceTime: '09:00',
        cadenceDayOfWeek: 1,
        timezone: 'UTC',
      },
      new Date('2026-06-01T09:00:00Z'),
    );
    expect(period.end.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(svc.formatPeriodLabel(period, 'UTC')).toBe('May 25 – May 31, 2026');
  });

  it('names the local day, not the UTC one, past the date line', () => {
    // Aug 3 00:00 IST → Aug 10 00:00 IST; both boundaries are Aug 2 / Aug 9 in
    // UTC, so a label formatted in the wrong zone is off by a day at both ends.
    const period = {
      start: new Date('2026-08-02T18:30:00Z'),
      end: new Date('2026-08-09T18:30:00Z'),
    };
    expect(svc.formatPeriodLabel(period, 'Asia/Kolkata')).toBe(
      'Aug 3 – Aug 9, 2026',
    );
  });
});
