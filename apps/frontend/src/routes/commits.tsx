import { useMemo } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { BriefCommitType } from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { EmptyState } from "@/components/devsummary/shared/empty-state";
import {
  ErrorState,
  extractErrorMessage,
} from "@/components/devsummary/shared/error-state";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { CommitRow } from "@/components/devsummary/briefs/commit-row";
import {
  CommitFilters,
  EMPTY_COMMIT_FILTERS,
  hasActiveCommitFilters,
  type CommitFiltersValue,
} from "@/components/devsummary/commits/commit-filters";
import { useConnectReposGate } from "@/hooks/use-connect-repos-gate";
import { useGetCommits, type CommitListFilters } from "@/hooks/api/use-commits";
import { localDayBoundary } from "@/lib/day-boundary";
import { cn } from "@/lib/utils";
import type { CommitsSearch } from "@/router";

const PAGE_SIZE = 50;

/** Named from the path the door came from; anything else is a bare "Back". */
function backLabel(path: string): string {
  if (path === "/") return "Back to home";
  if (path === "/briefs") return "Back to briefs";
  if (path.startsWith("/briefs/")) return "Back to brief";
  if (path === "/integrations/github") return "Back to integrations";
  return "Back";
}

export function CommitsPage() {
  const search = useSearch({ strict: false }) as CommitsSearch;
  const navigate = useNavigate();

  const pageIndex = search.page;
  const filterValues: CommitFiltersValue = {
    from: search.from,
    to: search.to,
    commitType: search.commitType,
    repo: search.repo,
    analyzedOnly: search.analyzedOnly,
  };

  const filters = useMemo<CommitListFilters>(() => {
    const f: CommitListFilters = { limit: PAGE_SIZE };
    // Half-open: `from` is the from-day's local midnight, `to` the local
    // midnight of the day *after* the to-day, so the to-day is included.
    if (search.from) f.from = localDayBoundary(search.from, false);
    if (search.to) f.to = localDayBoundary(search.to, true);
    if (search.commitType) f.commitType = search.commitType as BriefCommitType;
    if (search.repo) f.repositoryId = search.repo;
    if (search.analyzedOnly) f.analyzedOnly = true;
    return f;
  }, [search]);

  const commitsQuery = useGetCommits(filters);

  const pages = commitsQuery.data?.pages ?? [];
  const items = pages[pageIndex]?.data.items ?? [];
  const hasFilters = hasActiveCommitFilters(filterValues);

  const gate = useConnectReposGate();
  if (gate) return gate;

  const apply = (next: Partial<CommitsSearch>) =>
    navigate({ to: "/commits", search: { ...search, ...next, page: 0 } });

  const canPrev = pageIndex > 0;
  const canNext =
    pageIndex < pages.length - 1 || (commitsQuery.hasNextPage ?? false);
  const showPager = canPrev || canNext;

  const handlePrev = () =>
    navigate({
      to: "/commits",
      search: { ...search, page: Math.max(0, search.page - 1) },
    });
  const handleNext = async () => {
    if (pageIndex < pages.length - 1) {
      navigate({ to: "/commits", search: { ...search, page: search.page + 1 } });
      return;
    }
    if (commitsQuery.hasNextPage && !commitsQuery.isFetchingNextPage) {
      const res = await commitsQuery.fetchNextPage();
      if (res.data && res.data.pages.length > pageIndex + 1) {
        navigate({
          to: "/commits",
          search: { ...search, page: search.page + 1 },
        });
      }
    }
  };

  return (
    <>
      {search.back ? (
        <div className="mb-3">
          <Link
            to={search.back as "/"}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> {backLabel(search.back)}
          </Link>
        </div>
      ) : null}

      <PageHeader
        title="Commits"
        description="Every commit DevSummary has read, with its AI analysis."
      />

      <CommitFilters
        value={filterValues}
        onChange={(next) => apply(next)}
        className="mb-6"
      />

      {commitsQuery.isLoading ? (
        <SkeletonList rows={6} rowHeight={48} />
      ) : commitsQuery.isError ? (
        <ErrorState
          message={extractErrorMessage(commitsQuery.error)}
          onRetry={() => commitsQuery.refetch()}
        />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title="No commits match these filters"
            description="Try widening the date range or clearing the type filter."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => apply(EMPTY_COMMIT_FILTERS)}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No commits yet"
            description="DevSummary reads a repository only once you pick the branch to read it on."
            action={
              <Button asChild size="sm">
                <Link to="/integrations/github/setup">Choose branches</Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <div
            className={cn(
              "overflow-hidden rounded-xl border bg-card transition-opacity",
              commitsQuery.isPlaceholderData && "opacity-60",
            )}
          >
            {items.map((commit) => (
              <CommitRow key={commit.commitId ?? commit.sha} commit={commit} />
            ))}
          </div>

          {showPager ? (
            <div className="mt-6 flex items-center justify-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                disabled={!canPrev}
              >
                <ChevronLeft className="size-3.5" /> Prev
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {pageIndex + 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNext}
                disabled={!canNext || commitsQuery.isFetchingNextPage}
              >
                {commitsQuery.isFetchingNextPage ? "Loading…" : "Next"}
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
