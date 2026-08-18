import type { BriefReportDay, WorkCategory } from "@launchstack/api-interfaces";
import {
  WORK_CATEGORIES,
  WORK_CATEGORY_CSS_VAR,
  WORK_CATEGORY_LABEL,
} from "@/components/devsummary/shared/commit-type-colors";
import { formatDayKey } from "../brief-utils";
import { useChartTooltip } from "./chart-tooltip-context";

const UNCLASSIFIED_COLOUR = "var(--muted-foreground)";

function dayTotal(d: BriefReportDay): number {
  return Object.values(d.counts).reduce((n, v) => n + v, 0);
}

/**
 * Stacked columns, one per day, segments in fixed category order. Heights are
 * percentages of the busiest day so the axis and the bars cannot drift apart.
 */
export function ActivityChart({
  daily,
  height = 120,
}: {
  daily: BriefReportDay[];
  height?: number;
}) {
  const tooltip = useChartTooltip();
  const max = daily.reduce((n, d) => Math.max(n, dayTotal(d)), 0);
  if (max === 0) return null;
  // Round the axis up to a multiple of 4 so the four gridlines land on integers.
  const axisMax = Math.ceil(max / 4) * 4;

  return (
    <div>
      <div className="relative" style={{ height }}>
        <div
          className="absolute inset-0 flex flex-col justify-between"
          aria-hidden="true"
        >
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className="block h-px bg-border" />
          ))}
        </div>
        <div
          className="absolute inset-y-0 left-0 flex w-6 flex-col justify-between font-mono text-[10px] text-muted-foreground"
          aria-hidden="true"
        >
          {[axisMax, (axisMax / 4) * 3, axisMax / 2, axisMax / 4, 0]
            .filter((_, i) => i % 2 === 0)
            .map((v) => (
              <span key={v} className="-translate-y-1/2">
                {v}
              </span>
            ))}
        </div>
        <div className="absolute inset-y-0 left-8 right-0 flex items-end gap-2.5">
          {daily.map((d) => {
            const total = dayTotal(d);
            return (
              <div
                key={d.date}
                className="flex h-full min-w-0 flex-1 flex-col justify-end"
              >
                <span className="mb-[3px] text-center font-mono text-[10.5px] text-muted-foreground">
                  {total || ""}
                </span>
                <span
                  className="flex flex-col-reverse gap-0.5"
                  style={{ height: `${(total / axisMax) * 100}%` }}
                >
                  {WORK_CATEGORIES.filter((c) => d.counts[c] > 0).map((c) => (
                    <span
                      key={c}
                      className="block rounded-[2px] transition-[filter] hover:brightness-110"
                      style={{
                        flex: d.counts[c],
                        background: WORK_CATEGORY_CSS_VAR[c as WorkCategory],
                      }}
                      {...tooltip.bind(
                        formatDayKey(d.date),
                        `${d.counts[c]} ${WORK_CATEGORY_LABEL[c as WorkCategory][d.counts[c] === 1 ? 0 : 1]}`,
                      )}
                    />
                  ))}
                  {d.counts.unclassified > 0 ? (
                    <span
                      className="block rounded-[2px]"
                      style={{
                        flex: d.counts.unclassified,
                        background: UNCLASSIFIED_COLOUR,
                        opacity: 0.4,
                      }}
                      {...tooltip.bind(
                        formatDayKey(d.date),
                        `${d.counts.unclassified} not yet analysed`,
                      )}
                    />
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ml-8 mt-2 flex gap-2.5">
        {daily.map((d) => (
          <span
            key={d.date}
            className="min-w-0 flex-1 text-center font-mono text-[10.5px] text-muted-foreground"
          >
            {Number(d.date.slice(8))}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        {WORK_CATEGORIES.map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span
              className="size-[9px] shrink-0 rounded-[2px]"
              style={{ background: WORK_CATEGORY_CSS_VAR[c as WorkCategory] }}
            />
            {WORK_CATEGORY_LABEL[c as WorkCategory][1]}
          </span>
        ))}
      </div>
    </div>
  );
}
