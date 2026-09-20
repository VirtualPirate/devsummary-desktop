import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
        up ? "text-gb-status-shipped" : "text-gb-status-at-risk",
      )}
    >
      <Icon className="size-3.5" />
      {Math.abs(Math.round(pct * 100))}%
    </span>
  );
}

export function ChartCard({
  title,
  subtitle,
  headline,
  delta,
  isLoading,
  isEmpty,
  action,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  headline?: ReactNode;
  /** undefined = no delta slot; null = render "—" */
  delta?: number | null;
  isLoading: boolean;
  isEmpty: boolean;
  /** Right-aligned on the title row — the card's way through to a full list. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-mono text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
            {title}
          </CardTitle>
          {action}
        </div>
        {headline !== undefined ? (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums tracking-tight">
              {headline}
            </span>
            {delta !== undefined ? <DeltaBadge pct={delta} /> : null}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        <div className="relative h-[180px]">
          {isLoading ? (
            <Skeleton className="h-full w-full rounded-xl" />
          ) : (
            <>
              {children}
              {isEmpty ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-e1">
                    No activity this period
                  </span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
