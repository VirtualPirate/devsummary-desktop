/**
 * Run from apps/frontend with:
 *   esbuild src/components/devsummary/home/fix-feature-ratio.check.ts \
 *     --bundle --format=esm --platform=node --alias:@=./src --outfile=/tmp/f.mjs && node /tmp/f.mjs
 *
 * What is pinned here: the window is trailing and warmed by the buckets
 * before the displayed range, a window with no fix/feature work sits at 50%
 * instead of breaking the line, and only fix + feature count toward the share.
 */
import assert from "node:assert/strict";
import type { CommitActivityPoint } from "@launchstack/api-interfaces";
import {
  medianFixShare,
  NEUTRAL_RATIO,
  rollingFixShare,
} from "./fix-feature-ratio.ts";

const point = (
  date: string,
  fix: number,
  feature: number,
  chore = 0,
): CommitActivityPoint => ({
  date,
  commits: fix + feature + chore,
  additions: 0,
  deletions: 0,
  byType: {
    feature,
    fix,
    optimization: 0,
    refactor: 0,
    docs: 0,
    test: 0,
    chore,
    unclassified: 0,
  },
});

// Warm-up buckets are summed but not emitted.
const warmed = rollingFixShare(
  [point("2026-01-01", 3, 1), point("2026-01-02", 0, 0), point("2026-01-03", 1, 3)],
  7,
  "2026-01-03",
);
assert.equal(warmed.length, 1);
assert.equal(warmed[0].fix, 4);
assert.equal(warmed[0].feature, 4);
assert.equal(warmed[0].ratio, 0.5);
assert.equal(warmed[0].empty, false);

// The window is trailing, so buckets older than it drop out.
const trailing = rollingFixShare(
  [point("2026-01-01", 10, 0), point("2026-01-02", 0, 2), point("2026-01-03", 0, 2)],
  2,
  "2026-01-03",
);
assert.equal(trailing[0].fix, 0);
assert.equal(trailing[0].feature, 4);
assert.equal(trailing[0].ratio, 0);

// No fix or feature work anywhere in the window: neutral, not a gap.
const quiet = rollingFixShare([point("2026-01-01", 0, 0, 5)], 7, "2026-01-01");
assert.equal(quiet[0].ratio, NEUTRAL_RATIO);
assert.equal(quiet[0].empty, true);

// Median, not the last bucket: an odd count takes the middle, an even one
// averages the two middles, and an empty series has no headline at all.
const share = (ratio: number) => ({ date: "", ratio, fix: 0, feature: 0, empty: false });
assert.equal(medianFixShare([share(0), share(0.8), share(0.1)]), 0.1);
assert.equal(medianFixShare([share(0), share(0.25), share(0.75), share(1)]), 0.5);
assert.equal(medianFixShare([]), null);

console.log("fix-feature-ratio ok");
