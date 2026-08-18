/**
 * @jest-environment <rootDir>/../test/timezone-jest-environment.js
 * @jest-environment-options {"timezone": "America/New_York"}
 */
import { CadenceService } from '../services/cadence.service';

/**
 * Finding 6 of docs/timezone-audit.md: cadence math must depend on the
 * SCHEDULE's timezone only, never on the zone the process happens to run in.
 *
 * Every expectation below is the value the service produces under `TZ=UTC`;
 * the only variable is the server zone. New York jumps 02:00 -> 03:00 on
 * 2026-03-08, so a fabricated `new Date(2026, 2, 8, 2, 30)` wall clock is
 * silently rewritten to 03:30 before the timezone conversion reads it — which
 * moved every 02:30 schedule an hour late whatever its own zone.
 *
 * The Santiago half of the same bug (midnight boundaries) lives in
 * `cadence.service.server-tz-santiago.spec.ts`; one file can pin one zone.
 */
const svc = new CadenceService();

describe('CadenceService with the server in America/New_York', () => {
  it('reports the pinned server zone (guards the harness itself)', () => {
    expect(new Date(2026, 2, 8, 2, 30).getHours()).toBe(3);
  });

  it('daily — 02:30 Asia/Kolkata is unmoved by the server gap', () => {
    const next = svc.computeNextRunAt(
      { cadenceType: 'daily', cadenceTime: '02:30', timezone: 'Asia/Kolkata' },
      new Date('2026-03-07T12:00:00Z'), // 17:30 IST
    );
    // 2026-03-08 02:30 IST = 2026-03-07T21:00Z. Kolkata has no DST at all.
    expect(next.toISOString()).toBe('2026-03-07T21:00:00.000Z');
  });

  it('daily — a 45-minute-offset zone is not rounded to the hour', () => {
    // Asia/Kathmandu is +05:45, so 02:30 there is 20:45Z — a value the gap
    // round-up would destroy. The server gap must not make the schedule look
    // like a gap time at all.
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'daily',
        cadenceTime: '02:30',
        timezone: 'Asia/Kathmandu',
      },
      new Date('2026-03-07T12:00:00Z'),
    );
    expect(next.toISOString()).toBe('2026-03-07T20:45:00.000Z');
  });

  it('weekly — Sunday 02:30 Asia/Kolkata is unmoved by the server gap', () => {
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'weekly',
        cadenceTime: '02:30',
        cadenceDayOfWeek: 0, // JS getDay semantics: Sunday
        timezone: 'Asia/Kolkata',
      },
      new Date('2026-03-07T12:00:00Z'), // Saturday
    );
    expect(next.toISOString()).toBe('2026-03-07T21:00:00.000Z');
  });

  it('monthly — the 8th at 02:30 Asia/Kolkata is unmoved by the server gap', () => {
    const next = svc.computeNextRunAt(
      {
        cadenceType: 'monthly',
        cadenceTime: '02:30',
        cadenceDayOfMonth: 8,
        timezone: 'Asia/Kolkata',
      },
      new Date('2026-03-07T12:00:00Z'),
    );
    expect(next.toISOString()).toBe('2026-03-07T21:00:00.000Z');
  });

  it('rounds a time inside the SCHEDULE zone gap up to the first valid local instant', () => {
    // 02:30 does not exist in New_York on 2026-03-08, so it must land on
    // 03:00 EDT = 07:00Z. The old code compared already-rewritten fields, so
    // the guard passed on 03:30 EDT (07:30Z) instead.
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
