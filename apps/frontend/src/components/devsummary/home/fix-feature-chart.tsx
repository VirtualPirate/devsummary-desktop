import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  chartAxisProps,
  chartTooltipStyle,
  formatDateTick,
} from "./chart-format";
import type { FixFeaturePoint } from "./fix-feature-ratio";

const TICKS = [0, 0.25, 0.5, 0.75, 1];

function FixFeatureTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: FixFeaturePoint }[];
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div style={chartTooltipStyle} className="px-2.5 py-1.5">
      <div className="font-medium">{formatDateTick(p.date)}</div>
      <div className="text-muted-foreground">
        {p.empty
          ? "no fix or feature work"
          : `${Math.round(p.ratio * 100)}% fixes · ${p.fix} fix / ${p.feature} feature`}
      </div>
    </div>
  );
}

export function FixFeatureChart({ points }: { points: FixFeaturePoint[] }) {
  const last = points.at(-1);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid
          vertical={false}
          strokeDasharray="3 3"
          stroke="var(--border)"
        />
        <ReferenceArea
          y1={0.5}
          y2={1}
          fill="var(--gb-status-at-risk)"
          fillOpacity={0.1}
          stroke="none"
        >
          <Label
            value="firefighting"
            position="insideTopLeft"
            fill="var(--gb-status-at-risk)"
            fontSize={11}
          />
        </ReferenceArea>
        <XAxis
          dataKey="date"
          tickFormatter={formatDateTick}
          minTickGap={32}
          {...chartAxisProps}
        />
        <YAxis
          width={44}
          domain={[0, 1]}
          ticks={TICKS}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          {...chartAxisProps}
        />
        <Tooltip
          content={<FixFeatureTooltip />}
          cursor={{ stroke: "var(--border)" }}
        />
        <Line
          type="linear"
          dataKey="ratio"
          stroke="var(--gb-chart-bug)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          dot={false}
          isAnimationActive={false}
        />
        {last ? (
          <ReferenceDot
            x={last.date}
            y={last.ratio}
            r={4.5}
            fill="var(--gb-chart-bug)"
            stroke="var(--card)"
            strokeWidth={2}
          />
        ) : null}
      </LineChart>
    </ResponsiveContainer>
  );
}
