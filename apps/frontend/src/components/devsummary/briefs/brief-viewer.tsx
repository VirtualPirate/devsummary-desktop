import { AlertTriangle, Loader2, Moon } from "lucide-react";
import type { BriefResponse } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useGetBriefReport } from "@/hooks/api/use-briefs";
import {
  GENERATE_BLOCKED_REASON,
  useCommitsProcessing,
} from "@/hooks/use-commits-processing";
import { ScopeIdentity } from "./scope-label";
import { NoActivityBadge } from "./no-activity-badge";
import {
  formatPeriod,
  hasDeliveryFailure,
  isGenerationFailure,
  isNoActivityBrief,
  stripNoActivitySuffix,
} from "./brief-utils";
import { BriefReport, BriefStory } from "./report/brief-report";

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function GeneratingStory() {
  return (
    <>
      <div className="h-9 w-[min(520px,92%)] animate-pulse rounded-md bg-muted" />
      <div className="mt-2.5 h-9 w-[min(340px,68%)] animate-pulse rounded-md bg-muted" />
      <div className="mt-4 h-[18px] w-[min(420px,80%)] animate-pulse rounded-md bg-muted" />
      <section className="py-8">
        <p className="flex items-center gap-2.5 text-[13.5px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-brand" />
          Writing your brief — the summary is still being generated.
        </p>
        {[100, 94, 88, 72].map((w) => (
          <div
            key={w}
            className="mt-2 h-3 animate-pulse rounded bg-muted"
            style={{ width: `${w}%` }}
          />
        ))}
      </section>
    </>
  );
}

/**
 * Retry re-posts to the same ad-hoc generate endpoint, so it carries the same
 * gate (409 while commits are being processed) — a regenerated brief written
 * over a half-read history is as wrong as the first one. Its own component so
 * the ingest-status subscription only mounts on a failed brief, which is the
 * only state that renders it.
 */
function RetryButton({ onClick }: { onClick: () => void }) {
  const blocked = useCommitsProcessing();
  return (
    <span
      title={blocked ? GENERATE_BLOCKED_REASON : undefined}
      className="mt-4 inline-flex"
    >
      <Button type="button" onClick={onClick} size="sm" disabled={blocked}>
        Try again
      </Button>
    </span>
  );
}

export function BriefViewer({
  brief,
  onRetry,
  bare,
}: {
  brief: BriefResponse;
  onRetry?: () => void;
  bare?: boolean;
}) {
  const isWorking = brief.status === "pending" || brief.status === "generating";
  // Generation, not delivery: a brief that was written and then failed to send
  // still has a summary to read, and the banner below is what says so.
  const isFailed = isGenerationFailure(brief);
  const noActivity = isNoActivityBrief(brief);
  const deliveryFailed = hasDeliveryFailure(brief);

  // The report aggregates live data, so it is worth fetching while generating —
  // that is what fills the rail beside the skeleton. Not for a failed or
  // no-activity brief, where there is nothing to plot.
  const reportQuery = useGetBriefReport(
    isFailed || noActivity ? undefined : brief.id,
    { isWorking },
  );
  const report = reportQuery.data?.data;

  return (
    <article
      className={bare ? "" : "rounded-2xl border bg-card p-7 shadow-e1 sm:p-8"}
    >
      {isFailed || noActivity ? (
        <>
          <header className={cn("mb-6 border-b pb-6", bare && "pr-8")}>
            <div className="flex items-start justify-between gap-4">
              <ScopeIdentity
                scope={brief.scope}
                size="lg"
                meta={formatPeriod(
                  brief.periodStart,
                  brief.periodEnd,
                  brief.periodTimezone,
                )}
              />
              {noActivity ? <NoActivityBadge /> : null}
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {noActivity ? stripNoActivitySuffix(brief.title) : brief.title}
            </h1>
          </header>
          {isFailed ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />
                We couldn&rsquo;t generate this brief
              </div>
              {brief.failureReason ? (
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                  {brief.failureReason}
                </pre>
              ) : null}
              {onRetry ? <RetryButton onClick={onRetry} /> : null}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-muted/40 py-16 text-muted-foreground">
              <Moon className="size-7" />
              <p className="text-sm font-medium">
                A quiet period — nothing shipped
              </p>
            </div>
          )}
        </>
      ) : (
        <BriefReport
          brief={brief}
          report={report}
          isWorking={isWorking}
          storyColumn={
            isWorking ? <GeneratingStory /> : <BriefStory brief={brief} />
          }
        />
      )}

      {deliveryFailed ? (
        <div className="mt-6 rounded-xl border border-gb-status-at-risk/40 bg-gb-status-at-risk/5 p-3 text-xs text-gb-status-at-risk">
          {brief.deliveredChannels.length > 0
            ? "Some delivery channels failed"
            : "This brief was written but not delivered"}
          : {brief.failureReason}
        </div>
      ) : null}

      <footer className="mt-8 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:gap-4">
          <span>Generated: {formatTimestamp(brief.generatedAt)}</span>
          <span>Delivered: {formatTimestamp(brief.deliveredAt)}</span>
        </div>
      </footer>
    </article>
  );
}

