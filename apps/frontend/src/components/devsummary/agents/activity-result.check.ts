/**
 * Run with: node --experimental-strip-types src/components/devsummary/agents/activity-result.check.ts
 *
 * The frontend has no test runner. What is pinned here is the part that fails
 * silently in the browser: an unrecognised result shape draws an empty chart,
 * and an off-by-one range label names a day the chart does not cover.
 */
import assert from "node:assert/strict";
import {
  formatActivityRangeLabel,
  parseActivityResult,
  totalCommits,
} from "./activity-result.ts";

const point = (date: string, commits: number) => ({
  date,
  commits,
  additions: 0,
  deletions: 0,
  byType: { feature: commits, fix: 0 },
});

const payload = {
  points: [point("2026-08-04", 9), point("2026-08-05", 4)],
  range: {
    from: "2026-08-04T00:00:00+06:00",
    to: "2026-08-18T00:00:00+06:00",
    granularity: "day",
    timezone: "Asia/Dhaka",
  },
};

// The shape a tool actually hands over: its answer as a JSON string.
const fromString = parseActivityResult(JSON.stringify(payload));
assert.equal(fromString.kind, "activity");

// The MCP envelope, in case a client passes it through unopened.
assert.equal(
  parseActivityResult({
    content: [{ type: "text", text: JSON.stringify(payload) }],
  }).kind,
  "activity",
);

// Already parsed.
assert.equal(parseActivityResult(payload).kind, "activity");

// The MCP server reports a failed backend call as a valid result, not a throw.
assert.deepEqual(
  parseActivityResult(
    JSON.stringify({ error: "request failed with status 400" }),
  ),
  { kind: "error", message: "request failed with status 400" },
);

// Wrong shapes are errors, never a chart with no bars.
assert.equal(parseActivityResult(undefined).kind, "error");
assert.equal(parseActivityResult("not json at all").kind, "error");
assert.equal(parseActivityResult({ points: [] }).kind, "error"); // no range
assert.equal(
  parseActivityResult({ points: [{ date: "2026-08-04" }], range: payload.range })
    .kind,
  "error", // point with no commit count
);

// An empty period is a real answer — it renders the "no activity" overlay.
const empty = parseActivityResult({ points: [], range: payload.range });
assert.equal(empty.kind, "activity");
assert.equal(
  totalCommits(empty.kind === "activity" ? empty.activity.points : []),
  0,
);

assert.equal(totalCommits(payload.points), 13);

// The range ends at the next local midnight, so the label must name Aug 17 —
// naming Aug 18 claims a day the chart does not cover.
const label = formatActivityRangeLabel(payload.range);
assert.ok(label.includes("17"), `expected Aug 17 in ${label}`);
assert.ok(!label.includes("18"), `exclusive end leaked into ${label}`);

// A single-day range collapses to one date rather than "Aug 4 – Aug 4".
assert.ok(
  !formatActivityRangeLabel({
    from: "2026-08-04T00:00:00+06:00",
    to: "2026-08-05T00:00:00+06:00",
    timezone: "Asia/Dhaka",
  }).includes("–"),
);

// A zone past +12 is where anchoring at noon instead of the instant went wrong.
assert.ok(
  formatActivityRangeLabel({
    from: "2026-08-04T00:00:00+12:45",
    to: "2026-08-05T00:00:00+12:45",
    timezone: "Pacific/Chatham",
  }).includes("4"),
);

console.log("activity-result: all checks passed");
