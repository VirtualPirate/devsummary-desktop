import type { BriefReportDay } from "@launchstack/api-interfaces";
import { CHURN_CSS_VAR } from "@/components/devsummary/shared/commit-type-colors";
import { formatDayKey } from "../brief-utils";
import { useChartTooltip } from "./chart-tooltip-context";
import { ChartTable } from "./chart-table";

/**
 * Signed and grouped, coloured to the same token as the bar it describes — the
 * sign is what tells you which direction a figure moved, so it is never
 * dropped, and zero stays neutral rather than claiming a direction.
 */
function Churn({
  value,
  kind,
}: {
  value: number;
  kind: "added" | "removed";
}) {
  if (value === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span style={{ color: CHURN_CSS_VAR[kind] }}>
      {kind === "added" ? "+" : "−"}
      {value.toLocaleString()}
    </span>
  );
}

/**
 * Diverging bars: added above the zero line, removed below. Both halves share
 * one scale set by the busiest day, so the two directions stay comparable.
 */
export function ChurnChart({
  daily,
  totals,
  locCoverage,
}: {
  daily: BriefReportDay[];
  totals: { linesAdded: number; linesRemoved: number };
  locCoverage: { withLoc: number; total: number };
}) {
  const tooltip = useChartTooltip();
  const maxAdded = daily.reduce((n, d) => Math.max(n, d.linesAdded), 0);
  const maxRemoved = daily.reduce((n, d) => Math.max(n, d.linesRemoved), 0);
  const busiest = daily.reduce<BriefReportDay | null>(
    (best, d) =>
      !best ||
      d.linesAdded + d.linesRemoved > best.linesAdded + best.linesRemoved
        ? d
        : best,
    null,
  );
  if (maxAdded === 0 && maxRemoved === 0) return null;

  return (
    <div>
      <div className="flex items-stretch gap-2.5">
        {daily.map((d) => (
          <div key={d.date} className="min-w-0 flex-1">
            <div className="flex h-[62px] items-end">
              <span
                className="w-full rounded-t-[3px]"
                style={{
                  height: `${maxAdded ? (d.linesAdded / maxAdded) * 100 : 0}%`,
                  background: CHURN_CSS_VAR.added,
                }}
                {...tooltip.bind(
                  formatDayKey(d.date),
                  `+${d.linesAdded.toLocaleString()} added`,
                )}
              />
            </div>
            <div className="my-0.5 h-px bg-border" />
            <div className="flex h-[62px]">
              <span
                className="w-full rounded-b-[3px]"
                style={{
                  height: `${maxRemoved ? (d.linesRemoved / maxRemoved) * 100 : 0}%`,
                  background: CHURN_CSS_VAR.removed,
                }}
                {...tooltip.bind(
                  formatDayKey(d.date),
                  `−${d.linesRemoved.toLocaleString()} removed`,
                )}
              />
            </div>
            <div className="mt-1.5 text-center font-mono text-[10px] text-muted-foreground">
              {Number(d.date.slice(8))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="size-[9px] rounded-[2px]"
            style={{ background: CHURN_CSS_VAR.added }}
          />
          Added — {totals.linesAdded.toLocaleString()}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="size-[9px] rounded-[2px]"
            style={{ background: CHURN_CSS_VAR.removed }}
          />
          Removed — {totals.linesRemoved.toLocaleString()}
        </span>
      </div>

      {busiest ? (
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Scale is set by the busiest day: {formatDayKey(busiest.date)},
          +{busiest.linesAdded.toLocaleString()} / −
          {busiest.linesRemoved.toLocaleString()}.
        </p>
      ) : null}

      {locCoverage.withLoc < locCoverage.total ? (
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          Line counts cover {locCoverage.withLoc} of {locCoverage.total} commits
          — the rest are still being analysed.
        </p>
      ) : null}

      <ChartTable
        caption="Show code churn as a table"
        columns={["Day", "Added", "Removed"]}
        rows={daily.map((d) => ({
          key: d.date,
          cells: [
            formatDayKey(d.date),
            <Churn value={d.linesAdded} kind="added" />,
            <Churn value={d.linesRemoved} kind="removed" />,
          ],
        }))}
        footer={[
          "Total",
          <Churn value={totals.linesAdded} kind="added" />,
          <Churn value={totals.linesRemoved} kind="removed" />,
        ]}
      />
    </div>
  );
}
