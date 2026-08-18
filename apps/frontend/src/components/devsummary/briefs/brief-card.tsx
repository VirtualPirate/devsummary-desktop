import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import type { BriefResponse } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";
import {
  COMMIT_TYPE_CSS_VAR,
  COMMIT_TYPE_TINT_CLASS,
} from "@/components/devsummary/shared/commit-type-colors";
import { ScopeIdentity } from "./scope-label";
import { StatusBadge } from "./status-badge";
import { OneOffBadge } from "./one-off-badge";
import { formatRange, isNoActivityBrief } from "./brief-utils";
import {
  contributorLabel,
  splitSummary,
  workTags,
  type WorkTag,
} from "./brief-insights";

function WorkTagPill({ tag }: { tag: WorkTag }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        COMMIT_TYPE_TINT_CLASS[tag.key],
      )}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: COMMIT_TYPE_CSS_VAR[tag.key] }}
      />
      {tag.label}
    </span>
  );
}

export function BriefCard({ brief }: { brief: BriefResponse }) {
  const noActivity = isNoActivityBrief(brief);
  const isWorking = brief.status === "pending" || brief.status === "generating";
  const isFailed = brief.status === "failed";
  const { lead } = splitSummary(brief.summary);
  const tags = workTags(brief.commitTypeCounts);
  const isPlain = !noActivity && !isWorking && !isFailed;

  return (
    // A link, not a button: the report needs the full page's width, and a real
    // anchor means middle-click and "open in new tab" work on a list people
    // scan.
    <Link
      to="/briefs/$briefId"
      params={{ briefId: brief.id }}
      className={cn(
        "grid w-full grid-cols-[1fr_auto] items-start gap-5 rounded-2xl border border-transparent bg-card px-6 py-5 text-left shadow-e1 transition hover:-translate-y-0.5 hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        noActivity &&
          "border-dashed border-border bg-transparent shadow-none hover:translate-y-0 hover:bg-card hover:shadow-none",
        isFailed && "border-destructive/30",
      )}
    >
      <div className="min-w-0">
        <ScopeIdentity
          scope={brief.scope}
          meta={isPlain ? contributorLabel(brief.contributorCount) : undefined}
        />

        {isWorking ? (
          <div className="mt-3.5 space-y-2">
            <div className="h-5 w-2/3 animate-pulse rounded-md bg-muted" />
            <div className="h-3.5 w-11/12 animate-pulse rounded bg-muted/70" />
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted/70" />
          </div>
        ) : isFailed ? (
          <>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">
              Couldn&rsquo;t generate this brief
            </h3>
            {brief.failureReason ? (
              <p className="mt-1.5 line-clamp-1 text-xs text-destructive">
                {brief.failureReason}
              </p>
            ) : null}
          </>
        ) : noActivity ? (
          <h3 className="mt-3 text-base font-medium text-muted-foreground">
            A quiet week — nothing shipped
          </h3>
        ) : (
          <>
            <h3 className="mt-3 text-lg font-semibold leading-snug tracking-tight text-foreground">
              {brief.title || "(untitled)"}
            </h3>
            {lead ? (
              <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                {lead}
              </p>
            ) : null}
            {tags.length > 0 ? (
              <div className="mt-3.5 flex flex-wrap gap-2">
                {tags.map((t) => (
                  <WorkTagPill key={t.key} tag={t} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="flex min-w-[6.5rem] flex-col items-end gap-2 text-right">
        {isWorking ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand">
            <Loader2 className="size-3.5 animate-spin" /> Writing…
          </span>
        ) : isFailed ? (
          <StatusBadge status="failed" />
        ) : noActivity ? (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Resting
          </span>
        ) : null}
        {brief.briefScheduleId === null ? <OneOffBadge /> : null}
        <span className="text-xs text-muted-foreground">
          {formatRange(
            brief.periodStart,
            brief.periodEnd,
            brief.periodTimezone,
          )}
        </span>
      </div>
    </Link>
  );
}
