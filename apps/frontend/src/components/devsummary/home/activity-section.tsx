import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowUpRight, GitBranch } from "lucide-react";
import { useMemo } from "react";
import type { CommitActivityPoint } from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/devsummary/shared/empty-state";
import { SectionLabel } from "@/components/devsummary/shared/section-label";
import { useGetCollaborators } from "@/hooks/api/use-collaborators";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";
import {
  useGetCommitActivity,
  useGetCommitHours,
} from "@/hooks/api/use-analytics";
import { extractErrorMessage } from "@/lib/extract-error";
import {
  dateKey,
  periodDelta,
  resolveActivityWindow,
} from "@/lib/activity-window";
import { addDaysKey } from "@/lib/calendar-grid";
import type { ClassifiedCommitType } from "@/components/devsummary/shared/commit-type-colors";
import type { HomeSearch } from "@/router";
import { homeFilterPrefs, saveFilters } from "@/stores/filter-prefs-store";
import { ActivityFilters } from "./activity-filters";
import { ChartCard } from "./chart-card";
import { formatCompact, formatSignedCompact } from "./chart-format";
import { CommitsChart } from "./commits-chart";
import { CommitTypesChart } from "./commit-types-chart";
import { FixFeatureChart } from "./fix-feature-chart";
import {
  fixFeatureWindowSize,
  medianFixShare,
  rollingFixShare,
} from "./fix-feature-ratio";
import { LocChart } from "./loc-chart";
import { offHoursShare, totalCommits } from "./work-hours";
import { WorkHoursHeatmap } from "./work-hours-heatmap";

function reduceTotals(points: CommitActivityPoint[]) {
  return points.reduce(
    (acc, p) => ({
      commits: acc.commits + p.commits,
      additions: acc.additions + p.additions,
      deletions: acc.deletions + p.deletions,
    }),
    { commits: 0, additions: 0, deletions: 0 },
  );
}

export function ActivitySection() {
  const search = useSearch({ strict: false }) as HomeSearch;
  const navigate = useNavigate();

  const window = useMemo(
    () =>
      resolveActivityWindow({
        range: search.range,
        from: search.from,
        to: search.to,
      }),
    [search.range, search.from, search.to],
  );

  const installationsQuery = useGithubInstallations();
  const collaboratorsQuery = useGetCollaborators();
  const repos = (installationsQuery.data?.data ?? []).flatMap((i) =>
    i.repositories.map((r) => ({ id: r.id, fullName: r.fullName })),
  );
  const collaborators = collaboratorsQuery.data?.data ?? [];

  const activityQuery = useGetCommitActivity({
    from: window.requestFrom.toISOString(),
    to: window.to.toISOString(),
    granularity: window.granularity,
    timezone: window.timezone,
    repositoryId: search.repo || undefined,
    collaboratorId: search.collaborator || undefined,
  });

  // Only the displayed half of the window: this card carries no delta, so
  // the previous period would just dilute the heatmap.
  const hoursQuery = useGetCommitHours({
    from: window.displayFrom.toISOString(),
    to: window.to.toISOString(),
    timezone: window.timezone,
    repositoryId: search.repo || undefined,
    collaboratorId: search.collaborator || undefined,
  });
  const hourCells = hoursQuery.data?.data.cells ?? [];
  const offHours = offHoursShare(hourCells);

  const points = activityQuery.data?.data.points ?? [];
  const display = points.filter((p) => p.date >= window.displayFromKey);
  const previous = points.filter((p) => p.date < window.displayFromKey);

  const fixShare = rollingFixShare(
    points,
    fixFeatureWindowSize(window.granularity),
    window.displayFromKey,
  );

  const medianShare = medianFixShare(fixShare);

  const totals = reduceTotals(display);
  const prevTotals = reduceTotals(previous);
  const net = totals.additions - totals.deletions;
  const prevNet = prevTotals.additions - prevTotals.deletions;

  const isLoading = activityQuery.isLoading;
  const isEmpty =
    !isLoading &&
    totals.commits === 0 &&
    totals.additions === 0 &&
    totals.deletions === 0;

  // The doors onto /commits. `window.to` is exclusive, so the last day the
  // cards actually show is the day before it; the explorer's `to` is a
  // calendar date, inclusive.
  const commitsSearch = {
    from: dateKey(window.displayFrom),
    to: addDaysKey(dateKey(window.to), -1),
    repo: search.repo,
    back: "/",
  };

  const viewAll = (label: string) => (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="h-auto px-2 py-1 text-xs font-normal text-muted-foreground hover:text-foreground"
    >
      <Link to="/commits" search={commitsSearch}>
        {label} <ArrowUpRight className="size-3.5" />
      </Link>
    </Button>
  );

  const openType = (type: ClassifiedCommitType) =>
    navigate({ to: "/commits", search: { ...commitsSearch, commitType: type } });

  if (installationsQuery.isSuccess && repos.length === 0) {
    return (
      <section className="mb-8">
        <SectionLabel className="mb-3">Activity</SectionLabel>
        <EmptyState
          icon={<GitBranch className="size-5" />}
          title="Connect GitHub to see activity trends"
          description="Install the DevSummary GitHub app and we'll start bringing in your commits."
          action={
            <Button asChild size="sm">
              <Link to="/integrations/github">Connect GitHub</Link>
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section className="mb-8">
      <SectionLabel className="mb-3">Activity</SectionLabel>

      <ActivityFilters
        value={{
          range: search.range,
          from: search.from,
          to: search.to,
          repo: search.repo,
          collaborator: search.collaborator,
        }}
        repos={repos}
        collaborators={collaborators}
        onChange={(next) => {
          // Remembered so returning to the dashboard with a bare URL re-applies it.
          saveFilters("home", homeFilterPrefs(next));
          navigate({
            to: "/",
            search: {
              range: next.range,
              from: next.from,
              to: next.to,
              repo: next.repo,
              collaborator: next.collaborator,
            },
            replace: true,
          });
        }}
      />

      {activityQuery.isError ? (
        <EmptyState
          title="We couldn't load your activity"
          description={extractErrorMessage(activityQuery.error)}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void activityQuery.refetch()}
            >
              Try again
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title="Lines of code"
            subtitle="additions vs deletions"
            headline={formatSignedCompact(net)}
            delta={periodDelta(net, prevNet).pct}
            isLoading={isLoading}
            isEmpty={isEmpty}
          >
            <LocChart points={display} />
          </ChartCard>

          <ChartCard
            title="Commits"
            subtitle={`per ${window.granularity}`}
            headline={formatCompact(totals.commits)}
            delta={periodDelta(totals.commits, prevTotals.commits).pct}
            isLoading={isLoading}
            isEmpty={isEmpty}
            action={viewAll("View all")}
          >
            <CommitsChart points={display} />
          </ChartCard>

          <ChartCard
            title="Commits by type"
            subtitle="AI-classified · analyzed commits only"
            isLoading={isLoading}
            isEmpty={isEmpty}
            action={viewAll("View all commits")}
            className="lg:col-span-2"
          >
            <CommitTypesChart points={display} onSelectType={openType} />
          </ChartCard>

          <ChartCard
            title="Fix vs feature"
            subtitle="median share of fix work in fix + feature commits, this period"
            headline={
              medianShare === null ? "—" : `${Math.round(medianShare * 100)}%`
            }
            isLoading={isLoading}
            isEmpty={isEmpty}
          >
            <FixFeatureChart points={fixShare} />
          </ChartCard>

          <ChartCard
            title="When work happens"
            subtitle="of commits land after 7pm or on a weekend"
            headline={
              offHours === null ? "—" : `${Math.round(offHours * 100)}%`
            }
            delta={null}
            isLoading={hoursQuery.isLoading}
            isEmpty={!hoursQuery.isLoading && totalCommits(hourCells) === 0}
          >
            <WorkHoursHeatmap cells={hourCells} />
          </ChartCard>
        </div>
      )}
    </section>
  );
}
