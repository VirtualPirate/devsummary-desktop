import { useState } from "react";
import { GitCommitHorizontal } from "lucide-react";
import {
  BRIEF_COMMIT_TYPES,
  type BriefCommitType,
} from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ErrorState,
  extractErrorMessage,
} from "@/components/devsummary/shared/error-state";
import { EmptyState } from "@/components/devsummary/shared/empty-state";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { useGetBrief, useGetBriefCommits } from "@/hooks/api/use-briefs";
import { cn } from "@/lib/utils";
import { CommitRow } from "./commit-row";

// Radix <SelectItem> forbids an empty-string value, so "any" is a sentinel
// mapped back to undefined (filter absent) in the change handler.
const ANY = "any";

export function BriefCommitsList({ briefId }: { briefId: string }) {
  const [contributor, setContributor] = useState<string | undefined>();
  const [commitType, setCommitType] = useState<BriefCommitType | undefined>();

  const query = useGetBriefCommits(briefId, { contributor, commitType });
  // Cached by the page's own useGetBrief — the type counts come for free and
  // keep the dropdown to types this brief actually has.
  const briefQuery = useGetBrief(briefId);
  const typeCounts = briefQuery.data?.data?.commitTypeCounts;

  const firstPage = query.data?.pages[0]?.data;
  const contributors = firstPage?.contributors ?? [];
  const hasFilter = !!contributor || !!commitType;

  if (query.isLoading) {
    return <SkeletonList rows={6} rowHeight={48} />;
  }
  if (query.isError) {
    return (
      <ErrorState
        message={extractErrorMessage(query.error)}
        onRetry={() => query.refetch()}
      />
    );
  }

  const commits = query.data?.pages.flatMap((page) => page.data.items) ?? [];

  return (
    <div>
      {contributors.length > 0 ? (
        <section className="mb-3 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">
                Contributor
              </Label>
              <Select
                value={contributor ?? ANY}
                onValueChange={(v) =>
                  setContributor(v === ANY ? undefined : v)
                }
              >
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue placeholder="All contributors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All contributors</SelectItem>
                  {contributors.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.key} ({c.commits})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select
                value={commitType ?? ANY}
                onValueChange={(v) =>
                  setCommitType(v === ANY ? undefined : (v as BriefCommitType))
                }
              >
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All types</SelectItem>
                  {BRIEF_COMMIT_TYPES.filter(
                    (t) => (typeCounts?.[t] ?? 0) > 0,
                  ).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t} ({typeCounts?.[t]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {hasFilter ? (
              <button
                type="button"
                onClick={() => {
                  setContributor(undefined);
                  setCommitType(undefined);
                }}
                className="pb-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {commits.length === 0 ? (
        <EmptyState
          icon={<GitCommitHorizontal className="size-6" />}
          title={
            hasFilter ? "No commits match these filters" : "No commits in this brief"
          }
          description={
            hasFilter
              ? "Try clearing the contributor or type filter."
              : "This brief has no linked commits for the selected period."
          }
        />
      ) : (
        <>
          <div
            className={cn(
              "overflow-hidden rounded-xl border bg-card transition-opacity",
              query.isPlaceholderData && "opacity-60",
            )}
          >
            {commits.map((commit) => (
              <CommitRow key={commit.commitId ?? commit.sha} commit={commit} />
            ))}
          </div>
          {query.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? "Loading…" : "Load 50 more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
