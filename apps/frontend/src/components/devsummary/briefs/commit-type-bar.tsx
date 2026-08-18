import type { BriefCommitTypeCounts } from "@launchstack/api-interfaces";
import {
  WORK_CATEGORIES,
  WORK_CATEGORY_BG_CLASS,
  WORK_CATEGORY_LABEL,
  WORK_CATEGORY_OF,
  type WorkCategory,
} from "@/components/devsummary/shared/commit-type-colors";
import { cn } from "@/lib/utils";

const UNCLASSIFIED_SWATCH = "bg-muted-foreground/40";

/** Folds the seven commit types into the five chart categories. */
function foldCounts(
  counts: BriefCommitTypeCounts,
): Array<{ key: WorkCategory | "unclassified"; count: number; swatch: string }> {
  const totals = new Map<WorkCategory | "unclassified", number>();
  for (const [type, n] of Object.entries(counts)) {
    if (n === 0) continue;
    const key = WORK_CATEGORY_OF[type as keyof BriefCommitTypeCounts];
    totals.set(key, (totals.get(key) ?? 0) + n);
  }
  // Ordered by count descending; unclassified always last regardless of size.
  const classified = WORK_CATEGORIES.filter((c) => (totals.get(c) ?? 0) > 0)
    .map((c) => ({
      key: c as WorkCategory | "unclassified",
      count: totals.get(c) as number,
      swatch: WORK_CATEGORY_BG_CLASS[c],
    }))
    .sort((a, b) => b.count - a.count);
  const unclassified = totals.get("unclassified") ?? 0;
  return unclassified > 0
    ? [
        ...classified,
        {
          key: "unclassified" as const,
          count: unclassified,
          swatch: UNCLASSIFIED_SWATCH,
        },
      ]
    : classified;
}

function labelFor(key: WorkCategory | "unclassified", count: number): string {
  if (key === "unclassified") return "unclassified";
  const [one, many] = WORK_CATEGORY_LABEL[key];
  return count === 1 ? one : many;
}

export function CommitTypeBar({
  counts,
  className,
}: {
  counts: BriefCommitTypeCounts;
  className?: string;
}) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;
  const segments = foldCounts(counts);

  return (
    <div className={className}>
      <div className="flex h-2 gap-px overflow-hidden rounded-full">
        {segments.map((s) => (
          <div
            key={s.key}
            className={s.swatch}
            style={{ width: `${(s.count / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 shrink-0 rounded-[3px]", s.swatch)} />
            {labelFor(s.key, s.count)} {s.count} (
            {Math.round((s.count / total) * 100)}%)
          </span>
        ))}
      </div>
    </div>
  );
}
