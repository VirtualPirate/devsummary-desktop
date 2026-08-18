import { AlertTriangle, Loader2, Mail, Moon } from "lucide-react";
import { toast } from "sonner";
import type { BriefResponse } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SlackMark } from "@/components/integrations/provider-marks";
import { extractErrorMessage } from "@/components/devsummary/shared/error-state";
import { useDeliverBrief, useGetBriefReport } from "@/hooks/api/use-briefs";
import { useGetBriefSchedules } from "@/hooks/api/use-brief-schedules";
import { useCurrentOrganization } from "@/hooks/api/use-organizations";
import { ScopeIdentity } from "./scope-label";
import { NoActivityBadge } from "./no-activity-badge";
import {
  formatPeriod,
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
  const isFailed = brief.status === "failed";
  const noActivity = isNoActivityBrief(brief);
  const hasPartialFailure =
    brief.status === "delivered" && !!brief.failureReason;

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
              {onRetry ? (
                <Button
                  type="button"
                  onClick={onRetry}
                  size="sm"
                  className="mt-4"
                >
                  Try again
                </Button>
              ) : null}
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

      {hasPartialFailure ? (
        <div className="mt-6 rounded-xl border border-gb-status-at-risk/40 bg-gb-status-at-risk/5 p-3 text-xs text-gb-status-at-risk">
          Some delivery channels failed: {brief.failureReason}
        </div>
      ) : null}

      <footer className="mt-8 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:gap-4">
          <span>Generated: {formatTimestamp(brief.generatedAt)}</span>
          <span>Delivered: {formatTimestamp(brief.deliveredAt)}</span>
        </div>
        <DeliverActions brief={brief} />
      </footer>
    </article>
  );
}

/**
 * Manual re-delivery, bottom right. A brief is delivered exactly once by its
 * schedule — a Slack post that hit `not_in_channel`, or a channel added to the
 * schedule after the fact, has no other way out.
 *
 * Shown only for the channels the brief's own schedule carries: sending
 * somewhere the schedule never named would be a surprise, and the backend
 * refuses it anyway.
 */
function DeliverActions({ brief }: { brief: BriefResponse }) {
  const deliver = useDeliverBrief();
  const schedulesQuery = useGetBriefSchedules();
  const orgQuery = useCurrentOrganization();

  const role = orgQuery.data?.data.role;
  const isAdmin = role === "owner" || role === "admin";
  const schedule = (schedulesQuery.data?.data ?? []).find(
    (s) => s.id === brief.briefScheduleId,
  );

  // No `generatedAt` means the failure was in generation, not delivery — there
  // is no summary to send.
  if (!isAdmin || !schedule || !brief.generatedAt) return null;

  // Per channel, never per brief: `status` is a whole-brief verdict, so a
  // manual Slack post marked the brief delivered and took the email button
  // with it even though no email had been sent.
  const stillOwed = (channel: "email" | "slack") =>
    !brief.deliveredChannels.includes(channel);

  const send = (channel: "email" | "slack") =>
    deliver.mutate(
      { briefId: brief.id, channel },
      {
        onSuccess: () =>
          toast.success(
            channel === "slack"
              ? "Posted to Slack"
              : `Sent to ${schedule.delivery.emails.length} recipient${
                  schedule.delivery.emails.length === 1 ? "" : "s"
                }`,
          ),
        onError: (err) => toast.error(extractErrorMessage(err)),
      },
    );

  const pending = (channel: "email" | "slack") =>
    deliver.isPending && deliver.variables?.channel === channel;

  const showSlack = !!schedule.delivery.slackChannelId && stillOwed("slack");
  const showEmail = schedule.delivery.emails.length > 0 && stillOwed("email");
  if (!showSlack && !showEmail) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showSlack ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => send("slack")}
          disabled={deliver.isPending}
        >
          <SlackMark className="size-3.5" />
          {pending("slack") ? "Sending…" : "Deliver to Slack"}
        </Button>
      ) : null}
      {showEmail ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => send("email")}
          disabled={deliver.isPending}
        >
          <Mail className="size-3.5" />
          {pending("email") ? "Sending…" : "Deliver to Mail"}
        </Button>
      ) : null}
    </div>
  );
}
