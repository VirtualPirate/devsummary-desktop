/**
 * Run from apps/frontend with:
 *   esbuild src/components/devsummary/home/work-hours.check.ts \
 *     --bundle --format=esm --platform=node --alias:@=./src --outfile=/tmp/w.mjs && node /tmp/w.mjs
 *
 * The frontend has no test runner. What is pinned here is the arithmetic the
 * heatmap and its headline read from: the weekday scale is Monday-first, so
 * "weekend" is 5 and 6, and a window with no commits has no off-hours share.
 */
import assert from "node:assert/strict";
import type { CommitHoursCell } from "@launchstack/api-interfaces";
import { offHoursShare, totalCommits, workHoursGrid } from "./work-hours.ts";

const cell = (weekday: number, hour: number, commits: number): CommitHoursCell => ({
  weekday,
  hour,
  commits,
});

const grid = workHoursGrid([cell(0, 9, 3), cell(6, 23, 1)]);
assert.equal(grid.length, 7);
assert.equal(grid[0].length, 24);
assert.equal(grid[0][9], 3);
assert.equal(grid[6][23], 1);
// Every cell the response omitted is a real zero, not a hole.
assert.equal(grid[3][12], 0);

// Out-of-range rows from a bad response are dropped rather than growing the grid.
const guarded = workHoursGrid([cell(7, 0, 5), cell(0, 24, 5)]);
assert.equal(guarded.length, 7);
assert.equal(totalCommits([cell(7, 0, 5)]), 5);
assert.deepEqual(guarded[0], Array(24).fill(0));

// Monday 09:00 is core hours; Monday 19:00 and Saturday 09:00 are not.
assert.equal(offHoursShare([cell(0, 9, 4)]), 0);
assert.equal(offHoursShare([cell(0, 19, 4)]), 1);
assert.equal(offHoursShare([cell(5, 9, 4)]), 1);
// 18:00 is still inside the day; the boundary is "after 7pm" inclusive of 19:00.
assert.equal(offHoursShare([cell(0, 18, 1), cell(0, 19, 1)]), 0.5);
// A weekend evening is counted once, not twice.
assert.equal(offHoursShare([cell(6, 22, 1), cell(0, 10, 3)]), 0.25);
assert.equal(offHoursShare([]), null);
assert.equal(offHoursShare([cell(0, 9, 0)]), null);

console.log("work-hours.check.ts ok");
