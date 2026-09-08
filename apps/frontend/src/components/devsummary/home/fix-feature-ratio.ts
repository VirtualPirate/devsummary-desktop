import type { CommitActivityPoint } from "@launchstack/api-interfaces";

export interface FixFeaturePoint {
  date: string;
  /** Share of fix work in the trailing window, 0..1. */
  ratio: number;
  fix: number;
  feature: number;
  /** True when the window held no fix or feature commits at all. */
  empty: boolean;
}

/** A window with no fix and no feature work is neither firefighting nor
 * building, so it sits on the 50% line rather than breaking the series. */
export const NEUTRAL_RATIO = 0.5;

/** Buckets in the trailing window. Weeks get a shorter one so a year-long
 * range is not smoothed into a flat line. */
export function fixFeatureWindowSize(granularity: string): number {
  return granularity === "week" ? 4 : 7;
}

/**
 * Trailing-window fix share, one entry per point at or after `fromKey`.
 * `points` should include the buckets before `fromKey` too: they warm the
 * window up so the first displayed value is a full window, not a partial one.
 */
export function rollingFixShare(
  points: CommitActivityPoint[],
  windowSize: number,
  fromKey: string,
): FixFeaturePoint[] {
  const out: FixFeaturePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].date < fromKey) continue;
    let fix = 0;
    let feature = 0;
    for (let j = Math.max(0, i - windowSize + 1); j <= i; j++) {
      fix += points[j].byType.fix;
      feature += points[j].byType.feature;
    }
    const total = fix + feature;
    out.push({
      date: points[i].date,
      ratio: total > 0 ? fix / total : NEUTRAL_RATIO,
      fix,
      feature,
      empty: total === 0,
    });
  }
  return out;
}

/** Median share across the window. The last bucket alone swings to 0 or 100%
 * on a single commit, so the headline reads the middle of the series. */
export function medianFixShare(points: FixFeaturePoint[]): number | null {
  if (points.length === 0) return null;
  const sorted = points.map((p) => p.ratio).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
