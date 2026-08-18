import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { GitBranch } from "lucide-react";
import { useMemo } from "react";
import type { CommitActivityPoint } from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/devsummary/shared/empty-state";
import { SectionLabel } from "@/components/devsummary/shared/section-label";
import { useGetCollaborators } from "@/hooks/api/use-collaborators";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";
import { useGetCommitActivity } from "@/hooks/api/use-analytics";
import { extractErrorMessage } from "@/lib/extract-error";
import { computeActivityWindow, periodDelta } from "@/lib/activity-window";
import type { HomeSearch } from "@/router";
import { homeFilterPrefs, saveFilters } from "@/stores/filter-prefs-store";
import { ActivityFilters } from "./activity-filters";
import { ChartCard } from "./chart-card";
import { formatCompact, formatSignedCompact } from "./chart-format";
import { CommitsChart } from "./commits-chart";
import { CommitTypesChart } from "./commit-types-chart";
import { LocChart } from "./loc-chart";

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
    () => computeActivityWindow(search.range),
    [search.range],
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

  const points = activityQuery.data?.data.points ?? [];
  const display = points.filter((p) => p.date >= window.displayFromKey);
  const previous = points.filter((p) => p.date < window.displayFromKey);

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
          >
            <CommitsChart points={display} />
          </ChartCard>

          <ChartCard
            title="Commits by type"
            subtitle="AI-classified · analyzed commits only"
            isLoading={isLoading}
            isEmpty={isEmpty}
            className="lg:col-span-2"
          >
            <CommitTypesChart points={display} />
          </ChartCard>
        </div>
      )}
    </section>
  );
}
