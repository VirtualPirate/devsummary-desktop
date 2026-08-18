import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CommitActivityPoint } from "@launchstack/api-interfaces";
import {
  chartAxisProps,
  chartTooltipStyle,
  formatCompact,
  formatDateTick,
  formatDateTickLabel,
} from "./chart-format";

export function LocChart({ points }: { points: CommitActivityPoint[] }) {
  const last = points[points.length - 1];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={points}
        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
      >
        <defs>
          <linearGradient id="loc-additions" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--gb-status-shipped)"
              stopOpacity={0.2}
            />
            <stop
              offset="100%"
              stopColor="var(--gb-status-shipped)"
              stopOpacity={0.02}
            />
          </linearGradient>
        </defs>
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
        <YAxis width={44} tickFormatter={formatCompact} {...chartAxisProps} />
        <Tooltip
          contentStyle={chartTooltipStyle}
          labelFormatter={formatDateTickLabel}
        />
        <Area
          type="monotone"
          dataKey="additions"
          name="Added"
          stroke="var(--gb-status-shipped)"
          fill="url(#loc-additions)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="deletions"
          name="Deleted"
          stroke="var(--destructive)"
          strokeWidth={2}
          dot={false}
        />
        {last ? (
          <ReferenceDot
            x={last.date}
            y={last.additions}
            r={3.5}
            fill="var(--gb-status-shipped)"
            stroke="var(--card)"
            strokeWidth={2}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
