import type { FC } from "react";
import {
  useAssistantToolUI,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { AlertCircle } from "lucide-react";

import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { ChartCard } from "@/components/devsummary/home/chart-card";
import { CommitTypesChart } from "@/components/devsummary/home/commit-types-chart";
import { formatCompact } from "@/components/devsummary/home/chart-format";
import {
  formatActivityRangeLabel,
  parseActivityResult,
  totalCommits,
} from "./activity-result";

/**
 * Renders the `activity_stats` tool result as the same bar chart the Home
 * dashboard draws, instead of `ToolFallback`'s JSON blob. The tool answers with
 * `CommitActivityResponse` from the very same `AnalyticsService` the dashboard
 * calls, so the chart components take it unchanged.
 *
 * The raw call stays underneath, collapsed, so the numbers remain auditable.
 */
const ActivityChartToolRender: ToolCallMessagePartComponent = (props) => {
  const { result, status } = props;

  if (status?.type === "running" || result === undefined) {
    return (
      <div className="py-1.5">
        <ChartCard
          title="Commits"
          subtitle="Reading activity…"
          isLoading
          isEmpty={false}
        >
          <div />
        </ChartCard>
      </div>
    );
  }

  const parsed = parseActivityResult(result);

  if (parsed.kind === "error") {
    return (
      <div className="py-1.5">
        <p
          role="status"
          className="text-muted-foreground border-destructive/40 bg-destructive/5 flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
        >
          <AlertCircle className="text-destructive mt-px size-3.5 shrink-0" />
          <span>
            <span className="text-destructive font-medium">
              Could not read activity.
            </span>{" "}
            {parsed.message ?? "The agent's reply was not in a readable shape."}
          </span>
        </p>
        <ToolFallback {...props} />
      </div>
    );
  }

  const { points, range } = parsed.activity;
  const total = totalCommits(points);

  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <ChartCard
        title={`Commits · ${range.granularity === "week" ? "weekly" : "daily"}`}
        subtitle={`${formatActivityRangeLabel(range)} · ${range.timezone}`}
        headline={formatCompact(total)}
        isLoading={false}
        isEmpty={total === 0}
      >
        <CommitTypesChart points={points} />
      </ChartCard>
      <ToolFallback {...props} />
    </div>
  );
};

/**
 * Registers the renderer. Renders nothing itself, so it can sit anywhere inside
 * the runtime provider.
 *
 * `display: "standalone"` is what keeps the chart visible: `thread.tsx` folds
 * consecutive tool calls into a collapsed `group-tool`, and a chart the reader
 * has to expand a disclosure to find may as well not be drawn. Standalone parts
 * are excluded from that grouping.
 *
 * `useAssistantToolUI` is deprecated upstream in favour of a toolkit entry's
 * `render`, which does not apply here: the tools are defined on the server, so
 * the frontend has no toolkit to attach a renderer to. The name must match the
 * tool's own name exactly — a registration under a name nothing calls fires
 * never, and silently.
 */
export const ActivityChartToolUI: FC = () => {
  useAssistantToolUI({
    toolName: "activity_stats",
    render: ActivityChartToolRender,
    display: "standalone",
  });
  return null;
};
