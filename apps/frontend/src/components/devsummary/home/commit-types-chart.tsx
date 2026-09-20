import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CommitActivityPoint } from "@launchstack/api-interfaces";
import {
  CLASSIFIED_COMMIT_TYPES,
  COMMIT_TYPE_CSS_VAR,
  type ClassifiedCommitType,
} from "@/components/devsummary/shared/commit-type-colors";
import { WORK_TYPE_LABEL } from "@/components/devsummary/briefs/brief-insights";
import {
  chartAxisProps,
  chartTooltipStyle,
  formatDateTick,
  formatDateTickLabel,
} from "./chart-format";

// Executive-facing series names ("New features", "Doc updates") drawn from the
// shared work-type vocabulary, so the legend reads the same as brief cards.
function typeLabel(t: ClassifiedCommitType): string {
  const plural = WORK_TYPE_LABEL[t][1];
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}

export function CommitTypesChart({
  points,
  onSelectType,
}: {
  points: CommitActivityPoint[];
  /** A segment click opens the commit list pre-filtered to that type. */
  onSelectType?: (type: ClassifiedCommitType) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={points}
        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
        maxBarSize={48}
      >
        <CartesianGrid
          vertical={false}
          strokeDasharray="3 3"
          stroke="var(--border)"
        />
        <XAxis
          dataKey="date"
          tickFormatter={formatDateTick}
          minTickGap={32}
          {...chartAxisProps}
        />
        <YAxis width={44} allowDecimals={false} {...chartAxisProps} />
        <Tooltip
          contentStyle={chartTooltipStyle}
          labelFormatter={formatDateTickLabel}
          cursor={{ fill: "var(--muted)" }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          iconType="circle"
          iconSize={8}
        />
        {/* Stacked so each bar's height is the period's total analyzed commits
            and each band its type share. Rounded top only on the last series,
            which sits at the top of the stack. */}
        {CLASSIFIED_COMMIT_TYPES.map((t, i) => (
          <Bar
            key={t}
            stackId="type"
            dataKey={(p: CommitActivityPoint) => p.byType[t]}
            name={typeLabel(t)}
            fill={COMMIT_TYPE_CSS_VAR[t]}
            radius={
              i === CLASSIFIED_COMMIT_TYPES.length - 1
                ? [3, 3, 0, 0]
                : undefined
            }
            // The series' type is known here, so the handler needs nothing
            // out of recharts' click payload.
            onClick={onSelectType ? () => onSelectType(t) : undefined}
            style={onSelectType ? { cursor: "pointer" } : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
