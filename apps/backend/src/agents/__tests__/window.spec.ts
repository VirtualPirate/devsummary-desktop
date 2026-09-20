import { DEFAULT_WINDOW_DAYS, resolveWindow } from '../lib/window';

describe('resolveWindow', () => {
  it('resolves a relative lookback against the real clock', () => {
    const now = new Date('2026-08-18T09:30:00.000Z');
    expect(resolveWindow({ days: 7 }, DEFAULT_WINDOW_DAYS, now)).toEqual({
      kind: 'window',
      from: '2026-08-11T09:30:00.000Z',
      to: '2026-08-18T09:30:00.000Z',
    });
  });

  it('falls back to the default lookback when no window is named', () => {
    const now = new Date('2026-08-18T00:00:00.000Z');
    const w = resolveWindow({}, DEFAULT_WINDOW_DAYS, now);
    expect(w).toMatchObject({
      kind: 'window',
      from: '2026-07-19T00:00:00.000Z',
    });
  });

  it('leaves commit search unfiltered when it names no window', () => {
    expect(resolveWindow({}, null)).toEqual({ kind: 'none' });
  });

  it('clamps a lookback to a year', () => {
    const now = new Date('2026-08-18T00:00:00.000Z');
    expect(resolveWindow({ days: 5000 }, null, now)).toMatchObject({
      from: '2025-08-17T00:00:00.000Z',
    });
  });

  // The bug this all exists for: the model wrote the right month and day of the
  // wrong year, the backend answered 200 with empty buckets, and the chart
  // truthfully said "no activity".
  it('refuses an explicit window from the wrong year, naming today', () => {
    const now = new Date('2026-08-18T00:00:00.000Z');
    const w = resolveWindow(
      { from: '2023-08-11T00:00:00+00:00', to: '2023-08-18T00:00:00+00:00' },
      DEFAULT_WINDOW_DAYS,
      now,
    );
    expect(w.kind).toBe('error');
    if (w.kind !== 'error') throw new Error('unreachable');
    expect(w.message).toMatch(/2026-08-18/);
    expect(w.message).toMatch(/days/);
  });

  it('keeps an explicit window that is actually recent', () => {
    const now = new Date('2026-08-18T00:00:00.000Z');
    expect(
      resolveWindow(
        { from: '2026-08-01T00:00:00+06:00', to: '2026-08-15T00:00:00+06:00' },
        null,
        now,
      ),
    ).toMatchObject({ from: '2026-07-31T18:00:00.000Z' });
  });

  it('rejects a reversed or unparseable window', () => {
    const now = new Date('2026-08-18T00:00:00.000Z');
    expect(
      resolveWindow(
        { from: '2026-08-15T00:00:00Z', to: '2026-08-01T00:00:00Z' },
        null,
        now,
      ).kind,
    ).toBe('error');
    expect(resolveWindow({ from: 'last tuesday' }, null, now).kind).toBe(
      'error',
    );
  });

  it('rejects a window in the future', () => {
    const now = new Date('2026-08-18T00:00:00.000Z');
    const w = resolveWindow(
      { from: '2027-01-01T00:00:00Z', to: '2027-01-08T00:00:00Z' },
      null,
      now,
    );
    expect(w.kind).toBe('error');
    if (w.kind !== 'error') throw new Error('unreachable');
    expect(w.message).toMatch(/future/);
  });
});
