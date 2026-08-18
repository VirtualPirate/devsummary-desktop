import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StatItem {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  tone?: "positive" | "negative" | "neutral";
}

export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground", className)}>
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-baseline gap-1.5">
          <b className="font-semibold tabular-nums text-foreground">{item.value}</b>
          <span>{item.label}</span>
          {item.delta ? (
            <span
              className={cn(
                "text-xs tabular-nums",
                item.tone === "negative" && "text-gb-status-at-risk",
                item.tone === "positive" && "text-gb-status-shipped",
                item.tone === "neutral" && "text-muted-foreground",
              )}
            >
              {item.delta}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
