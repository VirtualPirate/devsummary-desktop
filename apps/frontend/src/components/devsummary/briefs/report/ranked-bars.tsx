import type { ReactNode } from "react";
import { useChartTooltip } from "./chart-tooltip-context";

export interface RankedBarRow {
  key: string;
  label: string;
  /** Rendered after the label — a bot badge, for instance. */
  labelSuffix?: ReactNode;
  value: number;
  /** Shown at the row's right edge; defaults to the value. */
  valueLabel?: string;
  colour: string;
  tooltip: [string, ...string[]];
}

/**
 * Horizontal ranked bars. Widths are relative to the largest row, not to the
 * total — this compares magnitudes, it is not a part-of-whole chart.
 */
export function RankedBars({ rows }: { rows: RankedBarRow[] }) {
  const tooltip = useChartTooltip();
  const max = rows.reduce((n, r) => Math.max(n, r.value), 0) || 1;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div
          key={r.key}
          className="grid grid-cols-[1fr_auto] items-baseline gap-x-2.5 gap-y-0.5"
        >
          <span className="flex min-w-0 items-center gap-[7px] text-[13px]">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ background: r.colour }}
            />
            <span className="truncate">{r.label}</span>
            {r.labelSuffix}
          </span>
          <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
            {r.valueLabel ?? r.value}
          </span>
          <span className="col-span-2 block h-[7px] overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(r.value / max) * 100}%`,
                background: r.colour,
              }}
              {...tooltip.bind(...r.tooltip)}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
