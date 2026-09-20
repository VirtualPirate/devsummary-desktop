import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  GitCommitHorizontal,
  Zap,
} from "lucide-react";
import type { BriefScopeType } from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { SectionLabel } from "@/components/devsummary/shared/section-label";
import { EmptyState } from "@/components/devsummary/shared/empty-state";
import { useConnectReposGate } from "@/hooks/use-connect-repos-gate";
import { useSetupTakeover } from "@/hooks/use-setup-takeover";
import {
  ErrorState,
  extractErrorMessage,
} from "@/components/devsummary/shared/error-state";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { BriefViewer } from "@/components/devsummary/briefs/brief-viewer";
import { BriefCard } from "@/components/devsummary/briefs/brief-card";
import { GenerateDialog } from "@/components/devsummary/briefs/generate-dialog";
import { NewScheduleButton } from "@/components/devsummary/schedules/new-schedule-button";
import {
  GENERATE_BLOCKED_REASON,
  useCommitsProcessing,
} from "@/hooks/use-commits-processing";
import {
  BriefFilters,
  type BriefFiltersValue,
} from "@/components/devsummary/briefs/brief-filters";
import { useGetBriefs, type BriefListFilters } from "@/hooks/api/use-briefs";
import { briefFilterPrefs, saveFilters } from "@/stores/filter-prefs-store";
import { localDayBoundary } from "@/lib/day-boundary";
import { cn } from "@/lib/utils";

type FilterType = "all" | BriefScopeType;

type BriefsSearch = {
  filterType: FilterType;
  from: string;
  to: string;
  scopeId: string;
  excludeNoActivity: boolean;
  page: number;
};

const TYPE_OPTIONS: { value: FilterType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "project", label: "Projects" },
  { value: "team", label: "Teams" },
  { value: "collaborator", label: "Collaborators" },
  { value: "repository", label: "Repositories" },
];

const EMPTY_FILTERS: BriefFiltersValue = {
  from: "",
  to: "",
  excludeNoActivity: false,
  scopeId: "",
};

/**
 * Disabled while commits are still being processed, matching the generate
 * endpoint's own gate (409) — a brief is never rewritten, so one covering a
 * half-read history stays wrong. The `<span>` carries the tooltip because a
 * disabled button fires no mouse events.
 */
function GenerateNowButton({ onClick }: { onClick: () => void }) {
  const blocked = useCommitsProcessing();
  return (
    <span
      title={blocked ? GENERATE_BLOCKED_REASON : undefined}
      className="inline-flex"
    >
      <Button size="sm" variant="outline" disabled={blocked} onClick={onClick}>
        <Zap className="size-3.5" /> Generate now
      </Button>
    </span>
  );
}

export function BriefsPage() {
  const search = useSearch({ strict: false }) as BriefsSearch;
  const navigate = useNavigate();
  const [generateOpen, setGenerateOpen] = useState(false);

  const { filterType, page: pageIndex } = search;
  const filterValues: BriefFiltersValue = {
    from: search.from,
    to: search.to,
    scopeId: search.scopeId,
    excludeNoActivity: search.excludeNoActivity,
  };

  const filters = useMemo<BriefListFilters>(() => {
    const f: BriefListFilters = { limit: 20 };
    if (search.filterType !== "all") {
      f.scopeType = search.filterType;
      if (search.scopeId) {
        if (search.filterType === "repository") {
          f.scopeRepositoryId = search.scopeId;
        } else if (search.filterType === "collaborator") {
          f.scopeCollaboratorId = search.scopeId;
        }
      }
    }
    if (search.from) f.from = localDayBoundary(search.from, false);
    if (search.to) f.to = localDayBoundary(search.to, true);
    if (search.excludeNoActivity) f.excludeNoActivity = true;
    return f;
  }, [search]);

  const briefsQuery = useGetBriefs(filters);

  const pages = briefsQuery.data?.pages ?? [];
  const items = pages[pageIndex]?.data.items ?? [];

  const isFirstPage = pageIndex === 0;
  const latest = isFirstPage ? items[0] : undefined;
  const listItems = isFirstPage ? items.slice(1) : items;

  const hasActiveFilters =
    filterType !== "all" ||
    !!filterValues.from ||
    !!filterValues.to ||
    filterValues.excludeNoActivity ||
    !!filterValues.scopeId;

  const gate = useConnectReposGate();
  // The console owns this page only when the list is empty *because nothing is
  // scheduled*. A one-off generated brief means there is content to show even
  // with no schedule, and filtering to nothing is a different story entirely.
  const takeover = useSetupTakeover({
    enabled: briefsQuery.isSuccess && items.length === 0 && !hasActiveFilters,
    onGenerate: () => setGenerateOpen(true),
  });

  if (gate) return gate;
  if (takeover) {
    return (
      <>
        {takeover}
        <GenerateDialog open={generateOpen} onOpenChange={setGenerateOpen} />
      </>
    );
  }

  // Every filter change is remembered so a later visit with a bare URL (sidebar
  // link, fresh tab) re-applies it — `page` is deliberately not part of that,
  // since the list is cursor-paginated and page 3 means nothing on arrival.
  const applyFilters = (next: BriefsSearch) => {
    saveFilters("briefs", briefFilterPrefs(next));
    navigate({ to: "/briefs", search: next });
  };

  const handleScopePill = (value: FilterType) =>
    applyFilters({ ...search, filterType: value, scopeId: "", page: 0 });

  const handleFiltersChange = (next: BriefFiltersValue) =>
    applyFilters({ ...search, ...next, page: 0 });

  const clearAll = () =>
    applyFilters({ filterType: "all", ...EMPTY_FILTERS, page: 0 });

  const canPrev = pageIndex > 0;
  const canNext =
    pageIndex < pages.length - 1 || (briefsQuery.hasNextPage ?? false);
  const showPager = canPrev || canNext;

  const handlePrev = () =>
    navigate({
      to: "/briefs",
      search: { ...search, page: Math.max(0, search.page - 1) },
    });
  const handleNext = async () => {
    if (pageIndex < pages.length - 1) {
      navigate({
        to: "/briefs",
        search: { ...search, page: search.page + 1 },
      });
      return;
    }
    if (briefsQuery.hasNextPage && !briefsQuery.isFetchingNextPage) {
      const res = await briefsQuery.fetchNextPage();
      if (res.data && res.data.pages.length > pageIndex + 1) {
        navigate({
          to: "/briefs",
          search: { ...search, page: search.page + 1 },
        });
      }
    }
  };

  return (
    <>
      <PageHeader
        title="Briefs"
        description="Plain-English summaries of what your team shipped, in flight, and at risk."
        actions={
          <>
            {/* Widens from the briefs' summaries to the raw commit history. */}
            <Button asChild size="sm" variant="ghost">
              <Link to="/commits" search={{ back: "/briefs" }}>
                <GitCommitHorizontal className="size-3.5" /> All commits
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/schedules">
                <CalendarClock className="size-3.5" /> Manage schedules
              </Link>
            </Button>
            <GenerateNowButton onClick={() => setGenerateOpen(true)} />
            <NewScheduleButton />
          </>
        }
      />

      <section className="mb-3">
        <div className="inline-flex flex-wrap gap-1 rounded-full border bg-card p-1 shadow-sm">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleScopePill(opt.value)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                filterType === opt.value
                  ? "bg-brand/12 text-brand"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <BriefFilters
        value={filterValues}
        scopeType={filterType}
        onChange={handleFiltersChange}
        className="mb-6"
      />

      {briefsQuery.isLoading ? (
        <SkeletonList rows={4} rowHeight={80} />
      ) : briefsQuery.isError ? (
        <ErrorState
          message={extractErrorMessage(briefsQuery.error)}
          onRetry={() => briefsQuery.refetch()}
        />
      ) : items.length === 0 ? (
        hasActiveFilters ? (
          <EmptyState
            title="No briefs match these filters"
            description="Try widening the date range or clearing filters."
            action={
              <Button size="sm" variant="outline" onClick={clearAll}>
                Clear filters
              </Button>
            }
          />
        ) : (
          // Reached when a schedule exists but has not produced anything yet —
          // the no-schedule case is the setup console's, above. Worded to hold in
          // both, since a failed status read also lands here.
          <EmptyState
            title="No briefs yet"
            description="Nothing has been written yet. Generate one now, or check when your schedule next runs."
            action={
              <div className="flex gap-2">
                <GenerateNowButton onClick={() => setGenerateOpen(true)} />
                <NewScheduleButton />
              </div>
            }
          />
        )
      ) : (
        <>
          {isFirstPage && latest ? (
            <section className="mb-8">
              {/* The latest brief renders inline, so it is the one row with no
                  card to click — this is its only way through to /briefs/$id. */}
              <div className="mb-2 flex items-center justify-between gap-3">
                <SectionLabel>Latest brief</SectionLabel>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 py-1 text-xs font-normal text-muted-foreground hover:text-foreground"
                >
                  <Link to="/briefs/$briefId" params={{ briefId: latest.id }}>
                    Open report <ArrowUpRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
              <BriefViewer brief={latest} />
            </section>
          ) : null}

          {listItems.length > 0 ? (
            <section>
              {isFirstPage ? (
                <SectionLabel className="mb-3">Earlier briefs</SectionLabel>
              ) : null}
              <div className="flex flex-col gap-3">
                {listItems.map((b) => (
                  <BriefCard key={b.id} brief={b} />
                ))}
              </div>
            </section>
          ) : null}

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
                disabled={!canNext || briefsQuery.isFetchingNextPage}
              >
                {briefsQuery.isFetchingNextPage ? "Loading…" : "Next"}
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          ) : null}
        </>
      )}

      <GenerateDialog open={generateOpen} onOpenChange={setGenerateOpen} />
    </>
  );
}
