/**
 * A relative lookback the model can ask for without knowing today's date.
 *
 * This exists because it did not know it. Asked "are we shipping more than last
 * month?", the model called `activity_stats` with
 * `from=2023-08-11&to=2023-08-18` — the right month and day of the wrong year,
 * three years before the commits it was asked about. The backend answered 200
 * with fourteen empty buckets and the chart truthfully reported no activity.
 * Nothing in the agent's environment states the current date, and no tool
 * returned one, so the window it wrote was a guess and every relative question
 * was answerable only by luck.
 *
 * The fix is to stop asking it for absolute instants. `days` is resolved here,
 * against the real clock, and an explicit window that lands outside living
 * memory is refused with today's date in the message rather than silently
 * returning nothing.
 */
export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 366;
/** How far back an explicit window may reach before it reads as a wrong year. */
const MAX_EXPLICIT_PAST_DAYS = 400;
/** Clock skew allowance, so "to = now" from a slightly fast agent still passes. */
const FUTURE_SLACK_MS = 2 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WindowArgs {
  from?: string;
  to?: string;
  days?: number;
}

export type ResolvedWindow =
  | { kind: 'window'; from: string; to: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

/**
 * @param defaultDays lookback when the call names no window at all; `null` means
 *   "no date filter", which is what `search_commits` wants.
 */
export function resolveWindow(
  args: WindowArgs,
  defaultDays: number | null,
  now: Date = new Date(),
): ResolvedWindow {
  const today = now.toISOString().slice(0, 10);

  if (typeof args.from === 'string' || typeof args.to === 'string') {
    const from = Date.parse(args.from ?? '');
    const to = Date.parse(args.to ?? '');
    if (Number.isNaN(from) || Number.isNaN(to)) {
      return {
        kind: 'error',
        message: `from and to must both be ISO timestamps with an offset. Today is ${today}; prefer the days argument over writing a date.`,
      };
    }
    if (from >= to) {
      return { kind: 'error', message: '`from` must be before `to`.' };
    }
    if (to < now.getTime() - MAX_EXPLICIT_PAST_DAYS * DAY_MS) {
      return {
        kind: 'error',
        message: `That window ends on ${new Date(to).toISOString().slice(0, 10)}, over a year ago. Today is ${today} — if you meant a recent period, pass days instead of from/to.`,
      };
    }
    if (from > now.getTime() + FUTURE_SLACK_MS) {
      return {
        kind: 'error',
        message: `That window starts on ${new Date(from).toISOString().slice(0, 10)}, in the future. Today is ${today}.`,
      };
    }
    return {
      kind: 'window',
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    };
  }

  const requested = Number.isFinite(args.days)
    ? Number(args.days)
    : defaultDays;
  if (requested === null) return { kind: 'none' };

  const days = Math.min(Math.max(Math.trunc(requested), 1), MAX_WINDOW_DAYS);
  return {
    kind: 'window',
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
  };
}
