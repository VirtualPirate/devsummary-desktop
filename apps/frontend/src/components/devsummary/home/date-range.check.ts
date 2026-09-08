/**
 * Run from apps/frontend with:
 *   esbuild src/components/devsummary/home/date-range.check.ts --bundle \
 *     --format=esm --platform=node --alias:@=./src --outfile=/tmp/d.mjs && node /tmp/d.mjs
 *
 * What is pinned: clicking never leaves an inverted range, so the user is
 * never asked to know that the earlier date has to be clicked first.
 */
import assert from "node:assert/strict";
import { nextDraft, rangeLabel } from "./date-range.ts";

const empty = { from: "", to: "" };

// First click opens the range, second closes it.
assert.deepEqual(nextDraft(empty, "2026-09-01"), { from: "2026-09-01", to: "" });
assert.deepEqual(nextDraft({ from: "2026-09-01", to: "" }, "2026-09-05"), {
  from: "2026-09-01",
  to: "2026-09-05",
});

// Clicking backwards restarts from the earlier day instead of inverting.
assert.deepEqual(nextDraft({ from: "2026-09-05", to: "" }, "2026-09-01"), {
  from: "2026-09-01",
  to: "",
});

// A complete range starts over on the next click.
assert.deepEqual(
  nextDraft({ from: "2026-09-01", to: "2026-09-05" }, "2026-09-03"),
  { from: "2026-09-03", to: "" },
);

// A single day is a valid range, not a restart.
assert.deepEqual(nextDraft({ from: "2026-09-03", to: "" }, "2026-09-03"), {
  from: "2026-09-03",
  to: "2026-09-03",
});

// Presets keep their label; an unordered or partial pair is not custom.
assert.equal(rangeLabel({ range: "30d", from: "", to: "" }), "Last 30 days");
assert.equal(rangeLabel({ range: "30d", from: "2026-09-05", to: "" }), "Last 30 days");
assert.equal(
  rangeLabel({ range: "30d", from: "2026-09-05", to: "2026-09-01" }),
  "Last 30 days",
);
assert.ok(
  rangeLabel({ range: "30d", from: "2026-09-01", to: "2026-09-05" }).includes("–"),
);

console.log("date-range ok");
