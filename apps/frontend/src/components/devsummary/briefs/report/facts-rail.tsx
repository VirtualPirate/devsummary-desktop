import { Link } from "@tanstack/react-router";
import type {
  BriefReportResponse,
  BriefResponse,
} from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import {
  WORK_CATEGORY_CSS_VAR,
  WORK_CATEGORY_LABEL,
} from "@/components/devsummary/shared/commit-type-colors";
import { formatDayKey, formatPeriod } from "../brief-utils";
import { ScopeIdentity } from "../scope-label";
import { StatusBadge } from "../status-badge";
import { RankedBars } from "./ranked-bars";

/** "+31%" / "−9%" / null when there is nothing to compare against. */
function formatRatio(r: number | null): string | null {
  if (r === null) return null;
  const pct = Math.round(r * 100);
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

function formatDiff(d: number | null): string | null {
  if (d === null) return null;
  if (d === 0) return "±0";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)}`;
}

function KpiRow({
  label,
  value,
  delta,
  direction,
}: {
  label: string;
  value: string;
  delta?: string | null;
  direction?: "up" | "down";
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-2.5 border-b py-[7px] last:border-b-0">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[15px] font-semibold tabular-nums">
        {value}
      </span>
      <span
        className={`min-w-[46px] text-right font-mono text-[10.5px] ${
          direction === "up"
            ? "text-gb-status-shipped"
            : direction === "down"
              ? "text-gb-status-at-risk"
              : "text-muted-foreground"
        }`}
      >
        {delta ?? ""}
      </span>
    </div>
  );
}

function directionOf(r: number | null): "up" | "down" | undefined {
  if (r === null || r === 0) return undefined;
  return r > 0 ? "up" : "down";
}

export function FactsRail({
  brief,
  report,
  isWorking,
}: {
  brief: BriefResponse;
  report: BriefReportResponse | undefined;
  isWorking: boolean;
}) {
  const t = report?.totals;
  const d = report?.deltas;

  return (
    <aside className="flex flex-col gap-6 rounded-2xl border bg-card p-6 shadow-e1 @min-[940px]:sticky @min-[940px]:top-[92px] @min-[940px]:max-h-[calc(100vh-116px)] @min-[940px]:overflow-auto">
      <ScopeIdentity
        scope={brief.scope}
        // The brief's own snapshot, not `report.timezone` — same value, but it
        // is here on first paint, so the label cannot flip a day when the
        // report query resolves.
        meta={formatPeriod(
          brief.periodStart,
          brief.periodEnd,
          brief.periodTimezone,
        )}
      />
      <StatusBadge status={brief.status} />

      {report?.scopeDeleted ? (
        <p className="text-xs text-muted-foreground">
          This brief&rsquo;s scope has been deleted, so its activity figures are
          no longer available. The written summary below is unchanged.
        </p>
      ) : (
        <>
          <div className="flex flex-col">
            <KpiRow
              label="Commits"
              value={String(t?.commits ?? brief.commitCount)}
              delta={formatRatio(d?.commits ?? null)}
              direction={directionOf(d?.commits ?? null)}
            />
            <KpiRow
              label="People"
              value={String(t?.contributors ?? brief.contributorCount)}
              delta={formatDiff(d?.contributors ?? null)}
              direction={directionOf(d?.contributors ?? null)}
            />
            <KpiRow
              label="Repositories"
              value={String(t?.repositoriesTouched ?? 0)}
              delta={t ? `of ${t.repositoriesInScope}` : null}
            />
            <KpiRow
              label="Lines added"
              value={(t?.linesAdded ?? 0).toLocaleString()}
              delta={formatRatio(d?.linesAdded ?? null)}
              direction={directionOf(d?.linesAdded ?? null)}
            />
            <KpiRow
              label="Lines removed"
              value={(t?.linesRemoved ?? 0).toLocaleString()}
              delta={formatRatio(d?.linesRemoved ?? null)}
              direction={directionOf(d?.linesRemoved ?? null)}
            />
            {t?.busiestDay ? (
              <KpiRow
                label="Busiest day"
                value={formatDayKey(t.busiestDay.date, { weekday: "short" })}
                delta={String(t.busiestDay.commits)}
              />
            ) : null}
          </div>

          {report && report.workBreakdown.length > 0 ? (
            <div>
              <h4 className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                What the work was
              </h4>
              <div className="mt-3">
                <RankedBars
                  rows={report.workBreakdown.map((w) => ({
                    key: w.category,
                    label: WORK_CATEGORY_LABEL[w.category][1],
                    value: w.commits,
                    valueLabel: `${w.commits} · ${Math.round((w.commits / (t?.commits || 1)) * 100)}%`,
                    colour: WORK_CATEGORY_CSS_VAR[w.category],
                    tooltip: [
                      WORK_CATEGORY_LABEL[w.category][1],
                      `${w.commits} of ${t?.commits ?? 0} commits`,
                    ],
                  }))}
                />
              </div>
            </div>
          ) : null}

          {report && report.contributors.length > 0 ? (
            <div>
              <h4 className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Top contributors
              </h4>
              <div className="mt-3">
                <RankedBars
                  rows={report.contributors.slice(0, 6).map((c) => ({
                    key: c.login ?? c.name,
                    label: c.name,
                    labelSuffix: c.isBot ? (
                      <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                        bot
                      </span>
                    ) : undefined,
                    value: c.commits,
                    colour: c.isBot
                      ? WORK_CATEGORY_CSS_VAR.upkeep
                      : WORK_CATEGORY_CSS_VAR.feature,
                    tooltip: [
                      c.name,
                      `${c.commits} commits · ${c.repositories} ${c.repositories === 1 ? "repository" : "repositories"}`,
                    ],
                  }))}
                />
              </div>
            </div>
          ) : null}
        </>
      )}

      {!isWorking && brief.commitCount > 0 ? (
        <Button asChild variant="outline" className="justify-center">
          <Link to="/briefs/$briefId/commits" params={{ briefId: brief.id }}>
            See the {brief.commitCount} commits
          </Link>
        </Button>
      ) : null}

      {isWorking ? (
        <p className="text-xs text-muted-foreground">
          These come from GitHub, so they are final. Only the written summary is
          still being generated.
        </p>
      ) : null}
    </aside>
  );
}
