import { useState } from "react";
import type { BriefHighlight } from "@launchstack/api-interfaces";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 5;

/**
 * The list arrives ranked, most important first, and nothing else in the
 * response carries that ranking — so the render order is load-bearing. Do not
 * sort or filter here. Paging is a view over that order: the printed number is
 * the absolute rank, not the position on the page.
 */
export function Highlights({
  highlights,
  commitCount,
}: {
  highlights: BriefHighlight[];
  commitCount: number;
}) {
  const [page, setPage] = useState(0);

  if (highlights.length === 0) return null;

  const pageCount = Math.ceil(highlights.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const visible = highlights.slice(start, start + PAGE_SIZE);

  return (
    <section className="border-b py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h4 className="text-[15px] font-semibold tracking-tight">Highlights</h4>
        <p className="text-[12.5px] text-muted-foreground">
          {highlights.length} from {commitCount} commits
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-px overflow-hidden rounded-xl bg-border">
        {visible.map((h, i) => (
          <div
            key={`${start + i}-${h.title}`}
            className="grid grid-cols-[auto_1fr] items-start gap-3 bg-card px-4 py-3"
          >
            <span className="pt-[3px] font-mono text-[11px] text-muted-foreground">
              {String(start + i + 1).padStart(2, "0")}
            </span>
            <span className="text-[14.5px]">
              {h.title}
              <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                {h.detail}
              </span>
            </span>
          </div>
        ))}
      </div>
      {pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeft className="size-3.5" /> Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            {start + 1}–{start + visible.length} of {highlights.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
          >
            Next <ChevronRight className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
