/**
 * @jest-environment <rootDir>/../test/timezone-jest-environment.js
 * @jest-environment-options {"timezone": "America/Santiago"}
 */
import { CadenceService } from '../services/cadence.service';

/**
 * Finding 6 of docs/timezone-audit.md, boundary half. Santiago jumps
 * 00:00 -> 01:00 on 2026-09-06, so a fabricated local midnight is rewritten to
 * 01:00 — which silently moved every period boundary an hour forward and made
 * a brief omit the first hour of commits on that day.
 *
 * Expectations are the values the service produces under `TZ=UTC`; the only
 * variable is the server zone. The schedule-time half of the same bug lives in
 * `cadence.service.server-tz-new-york.spec.ts`; one file can pin one zone.
 */
const svc = new CadenceService();

describe('CadenceService with the server in America/Santiago', () => {
  it('reports the pinned server zone (guards the harness itself)', () => {
    expect(new Date(2026, 8, 6, 0, 0).getHours()).toBe(1);
  });

  it('windowContaining daily — the UTC day still starts at midnight UTC', () => {
    const w = svc.windowContaining(
      { cadenceType: 'daily', cadenceTime: '00:00', timezone: 'UTC' },
      new Date('2026-09-06T12:00:00Z'),
    );
    expect(w.start.toISOString()).toBe('2026-09-06T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  it('computePeriod daily — the previous Asia/Kolkata day keeps its first hour', () => {
    const period = svc.computePeriod(
      { cadenceType: 'daily', cadenceTime: '07:30', timezone: 'Asia/Kolkata' },
      new Date('2026-09-07T02:00:00Z'), // 2026-09-07 07:30 IST
    );
    // 2026-09-06 00:00 IST = 2026-09-05T18:30Z.
    expect(period.start.toISOString()).toBe('2026-09-05T18:30:00.000Z');
    expect(period.end.toISOString()).toBe('2026-09-06T18:30:00.000Z');
  });

  it('windowContaining weekly — the ISO week still starts at midnight UTC', () => {
    const w = svc.windowContaining(
      {
        cadenceType: 'weekly',
        cadenceTime: '00:00',
        cadenceDayOfWeek: 1,
        timezone: 'UTC',
      },
      new Date('2026-09-06T12:00:00Z'), // Sunday — last day of its ISO week
    );
    expect(w.start.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  it('windowsInRange daily — windows still tile the transition day exactly', () => {
    const windows = svc.windowsInRange(
      { cadenceType: 'daily', cadenceTime: '00:00', timezone: 'UTC' },
      new Date('2026-09-05T00:00:00Z'),
      new Date('2026-09-08T00:00:00Z'),
    );
    expect(windows.map((w) => w.start.toISOString())).toEqual([
      '2026-09-05T00:00:00.000Z',
      '2026-09-06T00:00:00.000Z',
      '2026-09-07T00:00:00.000Z',
    ]);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].start.getTime()).toBe(windows[i - 1].end.getTime());
    }
  });

  it('daily next run at local midnight is unmoved by the server gap', () => {
    const next = svc.computeNextRunAt(
      { cadenceType: 'daily', cadenceTime: '00:00', timezone: 'UTC' },
      new Date('2026-09-05T12:00:00Z'),
    );
    expect(next.toISOString()).toBe('2026-09-06T00:00:00.000Z');
  });

  it('lookback bounds do not move with the server zone', () => {
    const from = new Date('2026-09-20T00:00:00Z');
    expect(
      svc
        .backfillLookbackStart({ cadenceType: 'daily' }, from, 30)
        .toISOString(),
    ).toBe('2026-08-21T00:00:00.000Z');
    expect(svc.lookbackStartFromMonths(from, 3).toISOString()).toBe(
      '2026-06-20T00:00:00.000Z',
    );
  });
});
