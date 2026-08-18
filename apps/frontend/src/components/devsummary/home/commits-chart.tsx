import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CommitActivityPoint } from "@launchstack/api-interfaces";
import {
  chartAxisProps,
  chartTooltipStyle,
  formatDateTick,
  formatDateTickLabel,
} from "./chart-format";

export function CommitsChart({ points }: { points: CommitActivityPoint[] }) {
  const lastIndex = points.length - 1;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={points}
        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
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
        <Bar dataKey="commits" name="Commits" radius={[4, 4, 0, 0]}>
          {points.map((p, i) => (
            <Cell
              key={p.date}
              fill="var(--gb-chart-accent)"
              fillOpacity={i === lastIndex ? 1 : 0.6}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
