import { cn } from "@/lib/utils";

// Maps the AI commit_type enum (fix | feature | optimization | refactor |
// docs | test | chore) to the design-system chart color utilities. Anything
// unknown or missing renders as a neutral chip.
const TYPE_STYLES: Record<string, string> = {
  feature: "text-gb-chart-feature border-gb-chart-feature/40 bg-gb-chart-feature/10",
  fix: "text-gb-chart-bug border-gb-chart-bug/40 bg-gb-chart-bug/10",
  refactor: "text-gb-chart-refactor border-gb-chart-refactor/40 bg-gb-chart-refactor/10",
  optimization:
    "text-gb-chart-optimization border-gb-chart-optimization/40 bg-gb-chart-optimization/10",
};

const NEUTRAL = "text-muted-foreground border-border bg-muted/40";

export function CommitTypeChip({
  type,
  className,
}: {
  type: string | null | undefined;
  className?: string;
}) {
  const label = type ?? "unanalyzed";
  const style = (type && TYPE_STYLES[type]) || NEUTRAL;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold lowercase tracking-[0.03em]",
        style,
        className,
      )}
    >
      {label}
    </span>
  );
}
