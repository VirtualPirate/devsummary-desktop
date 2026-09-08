import type { CommitHoursCell } from "@launchstack/api-interfaces";

/** Commits land after 7pm (local hour >= 19) or on a weekend (Sat/Sun,
 * i.e. weekday 5 or 6 on the response's Monday-first scale). */
const OFF_HOURS_FROM = 19;
const FIRST_WEEKEND_DAY = 5;

/** 7 rows (Mon..Sun) x 24 hour columns, zero-filled. The response only
 * carries non-zero cells, so the grid is what makes the empty ones exist. */
export function workHoursGrid(cells: CommitHoursCell[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const c of cells) {
    if (c.weekday < 0 || c.weekday > 6 || c.hour < 0 || c.hour > 23) continue;
    grid[c.weekday][c.hour] += c.commits;
  }
  return grid;
}

/** null = no commits at all, so there is no share to report. */
export function offHoursShare(cells: CommitHoursCell[]): number | null {
  let total = 0;
  let off = 0;
  for (const c of cells) {
    total += c.commits;
    if (c.weekday >= FIRST_WEEKEND_DAY || c.hour >= OFF_HOURS_FROM) {
      off += c.commits;
    }
  }
  return total > 0 ? off / total : null;
}

export function totalCommits(cells: CommitHoursCell[]): number {
  return cells.reduce((a, c) => a + c.commits, 0);
}
