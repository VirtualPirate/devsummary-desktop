import { useState } from "react";
import type { BriefHighlight, WorkCategory } from "@launchstack/api-interfaces";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  WORK_CATEGORY_BG_CLASS,
  WORK_CATEGORY_LABEL,
  WORK_CATEGORY_TINT_CLASS,
} from "@/components/devsummary/shared/commit-type-colors";
import {
  canFilterHighlights,
  highlightTagCounts,
  sentenceCase,
} from "../brief-insights";

const PAGE_SIZE = 5;

/** The singular label, e.g. "New feature" — what the row's pill reads. */
function pillLabel(category: WorkCategory): string {
  return sentenceCase(WORK_CATEGORY_LABEL[category][0]);
}

/**
 * The list arrives ranked, most important first, and nothing else in the
 * response carries that ranking — so the render order is load-bearing. Do not
 * sort or filter here beyond the category filter below, which preserves order.
 *
 * Two rules the ranking imposes on everything in this file:
 *
 * - The printed number is the highlight's absolute rank in the unfiltered
 *   list, never its position on the page or within a filter. Renumbering would
 *   let a filter change which item looks like the most important one.
 * - Paging is a view over that order, and a filter changes what the pages
 *   contain, so every filter action resets to page 0. Otherwise narrowing to
 *   two fixes while on page 2 shows an empty list.
 */
export function Highlights({
  highlights,
  commitCount,
}: {
  highlights: BriefHighlight[];
  commitCount: number;
}) {
  const [page, setPage] = useState(0);
  // Hidden rather than shown, so the default (nothing hidden) needs no
  // knowledge of which categories exist and survives a brief with none.
  const [hidden, setHidden] = useState<ReadonlySet<WorkCategory>>(
    () => new Set(),
  );

  if (highlights.length === 0) return null;

  const tags = highlightTagCounts(highlights);
  const canFilter = canFilterHighlights(highlights);

  const ranked = highlights.map((h, i) => ({ highlight: h, rank: i + 1 }));
  const matching = canFilter
    ? ranked.filter((r) => !(r.highlight.category && hidden.has(r.highlight.category)))
    : ranked;

  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const visible = matching.slice(start, start + PAGE_SIZE);

  function toggle(category: WorkCategory) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(category)) next.add(category);
      return next;
    });
    setPage(0);
  }

  return (
    <section className="border-b py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h4 className="text-[15px] font-semibold tracking-tight">Highlights</h4>
        <p className="text-[12.5px] text-muted-foreground">
          {highlights.length} from {commitCount} commits
        </p>
      </div>

      {canFilter ? (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={hidden.size === 0}
            onClick={() => {
              setHidden(new Set());
              setPage(0);
            }}
            className={`rounded-full border px-2.5 py-[3px] text-[12.5px] transition-colors ${
              hidden.size === 0
                ? "border-transparent bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All {highlights.length}
          </button>
          {tags.map(({ category, count }) => {
            const on = !hidden.has(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(category)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12.5px] transition-colors ${
                  on
                    ? `border-transparent ${WORK_CATEGORY_TINT_CLASS[category]}`
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${WORK_CATEGORY_BG_CLASS[category]}`}
                />
                {/*
                  Truncated rather than given a second, shorter label map:
                  `upkeep`'s plural is "upkeep (docs, tests, chores)" because it
                  doubles as a chart legend, and it is the only long one.
                */}
                <span className="max-w-[13rem] truncate">
                  {sentenceCase(WORK_CATEGORY_LABEL[category][1])}
                </span>
                <span className="font-mono text-[11px] tabular-nums opacity-70">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
          Every category is hidden. Turn one back on to see its highlights.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-px overflow-hidden rounded-xl bg-border">
          {visible.map(({ highlight: h, rank }) => (
            <div
              key={`${rank}-${h.title}`}
              className="grid grid-cols-[auto_1fr_auto] items-start gap-3 bg-card px-4 py-3"
            >
              <span className="pt-[3px] font-mono text-[11px] text-muted-foreground">
                {String(rank).padStart(2, "0")}
              </span>
              <span className="text-[14.5px]">
                {h.title}
                <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                  {h.detail}
                </span>
              </span>
              {/*
                No pill when the category is missing or unrecognised: every
                brief generated before the field existed reads back with title
                and detail only, and the column has no constraint to lean on.
              */}
              {h.category && WORK_CATEGORY_TINT_CLASS[h.category] ? (
                <span
                  className={`mt-px flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${WORK_CATEGORY_TINT_CLASS[h.category]}`}
                >
                  <span className="size-1.5 rounded-full bg-current" />
                  {pillLabel(h.category)}
                </span>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
          >
            <ChevronLeft className="size-3.5" /> Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            {start + 1}–{start + visible.length} of {matching.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage >= pageCount - 1}
          >
            Next <ChevronRight className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
