/**
 * Run from apps/frontend with:
 *   esbuild src/lib/calendar-grid.check.ts --bundle --format=esm --platform=node \
 *     --alias:@=./src --outfile=/tmp/c.mjs && node /tmp/c.mjs
 *
 * What is pinned: day stepping crosses month, year and DST boundaries without
 * losing or repeating a day, and the grid is Monday-first with pad cells.
 */
import assert from "node:assert/strict";
import {
  addDaysKey,
  calendarMonth,
  daysBetween,
  isDateKey,
} from "./calendar-grid.ts";

assert.equal(addDaysKey("2026-01-31", 1), "2026-02-01");
assert.equal(addDaysKey("2026-01-01", -1), "2025-12-31");
assert.equal(addDaysKey("2024-02-28", 1), "2024-02-29"); // leap year
// US spring-forward day: 23 local hours, still exactly one calendar day.
assert.equal(addDaysKey("2026-03-08", 1), "2026-03-09");
assert.equal(daysBetween("2026-03-08", "2026-03-09"), 1);
assert.equal(daysBetween("2026-01-01", "2026-12-31"), 364);
assert.equal(daysBetween("2026-03-09", "2026-03-08"), -1);

assert.equal(isDateKey("2026-02-31"), false); // parses, is not a day
assert.equal(isDateKey("2026-2-01"), false);
assert.equal(isDateKey("2026-02-28"), true);

// September 2026 starts on a Tuesday, so a Monday-first grid leads with one pad.
const sep = calendarMonth(2026, 8);
assert.equal(sep.weeks[0][0], null);
assert.equal(sep.weeks[0][1], "2026-09-01");
assert.equal(sep.weeks.flat().filter(Boolean).length, 30);
assert.ok(sep.weeks.every((w) => w.length === 7));

// Out-of-range months normalize, so "next month" needs no wrap-around branch.
assert.equal(calendarMonth(2026, 12).year, 2027);
assert.equal(calendarMonth(2026, 12).month, 0);
assert.equal(calendarMonth(2026, -1).month, 11);

console.log("calendar-grid ok");
