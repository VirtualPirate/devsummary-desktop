import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, GitCommitHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ErrorState,
  extractErrorMessage,
} from "@/components/devsummary/shared/error-state";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { ScopeLabel } from "@/components/devsummary/briefs/scope-label";
import { BriefCommitsList } from "@/components/devsummary/briefs/brief-commits-list";
import { formatPeriod } from "@/components/devsummary/briefs/brief-utils";
import { useGetBrief } from "@/hooks/api/use-briefs";

export function BriefCommitsPage() {
  const { briefId } = useParams({ strict: false });
  const briefQuery = useGetBrief(briefId);

  if (briefQuery.isLoading) {
    return (
      <>
        <BackLink briefId={briefId} />
        <SkeletonList rows={6} rowHeight={48} />
      </>
    );
  }
  if (briefQuery.isError || !briefQuery.data?.data) {
    return (
      <>
        <BackLink briefId={briefId} />
        <ErrorState
          message={extractErrorMessage(briefQuery.error)}
          onRetry={() => briefQuery.refetch()}
        />
      </>
    );
  }

  const brief = briefQuery.data.data;

  return (
    <>
      <BackLink briefId={brief.id} />
      <PageHeader
        eyebrow={brief.title || "Brief"}
        title="Commits"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <ScopeLabel scope={brief.scope} />
            <span>
              ·{" "}
              {formatPeriod(
                brief.periodStart,
                brief.periodEnd,
                brief.periodTimezone,
              )}{" "}
              ·{" "}
              {brief.contributorCount} contributors · {brief.commitCount} commits
            </span>
          </span>
        }
        actions={
          // Widens one brief's commits to the whole organization. Carries no
          // date filter: the brief's period is not the explorer's period.
          <Button asChild size="sm" variant="ghost">
            <Link to="/commits" search={{ back: `/briefs/${brief.id}/commits` }}>
              <GitCommitHorizontal className="size-3.5" /> All commits
            </Link>
          </Button>
        }
      />
      <BriefCommitsList briefId={brief.id} />
    </>
  );
}

function BackLink({ briefId }: { briefId: string | undefined }) {
  if (!briefId) {
    return null;
  }
  return (
    <div className="mb-3">
      <Link
        to="/briefs/$briefId"
        params={{ briefId }}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" /> Back to brief
      </Link>
    </div>
  );
}
