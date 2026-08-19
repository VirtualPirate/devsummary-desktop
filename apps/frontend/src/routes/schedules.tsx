import { Link } from "@tanstack/react-router";
import { CalendarClock, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { EmptyState } from "@/components/devsummary/shared/empty-state";
import { useConnectReposGate } from "@/hooks/use-connect-repos-gate";
import {
  ErrorState,
  extractErrorMessage,
} from "@/components/devsummary/shared/error-state";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { ScopeIdentity } from "@/components/devsummary/briefs/scope-label";
import { NewScheduleButton } from "@/components/devsummary/schedules/new-schedule-button";
import {
  useGetBriefSchedules,
  usePauseBriefSchedule,
  useResumeBriefSchedule,
} from "@/hooks/api/use-brief-schedules";
import {
  cadencePhrase,
  formatTimestamp,
  shortZone,
} from "@/lib/cadence-label";

function StatusPill({ paused }: { paused: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        paused
          ? "bg-muted text-muted-foreground"
          : "bg-gb-status-shipped/12 text-gb-status-shipped",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          paused ? "bg-muted-foreground/60" : "bg-gb-status-shipped",
        )}
      />
      {paused ? "Paused" : "Active"}
    </span>
  );
}

export function SchedulesPage() {
  const schedulesQuery = useGetBriefSchedules();
  const pauseMutation = usePauseBriefSchedule();
  const resumeMutation = useResumeBriefSchedule();
  const gate = useConnectReposGate();
  const toggling = pauseMutation.isPending || resumeMutation.isPending;

  if (gate) return gate;

  const handleToggle = async (id: string, paused: boolean) => {
    try {
      if (paused) {
        await resumeMutation.mutateAsync(id);
        toast.success("Schedule resumed");
      } else {
        await pauseMutation.mutateAsync(id);
        toast.success("Schedule paused");
      }
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Schedules"
        description="Recurring briefs that land in your inbox on a cadence."
        actions={<NewScheduleButton />}
      />

      {schedulesQuery.isLoading ? (
        <SkeletonList rows={4} />
      ) : schedulesQuery.isError ? (
        <ErrorState
          message={extractErrorMessage(schedulesQuery.error)}
          onRetry={() => schedulesQuery.refetch()}
        />
      ) : schedulesQuery.data?.data.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="size-6" />}
          title="No schedules yet"
          description="Set up a schedule so briefs arrive on their own — daily, weekly, or monthly."
          action={<NewScheduleButton />}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {schedulesQuery.data?.data.map((s) => (
            <Card
              key={s.id}
              className="group relative flex-row items-center gap-4 p-5 transition hover:-translate-y-0.5 hover:shadow-e2"
            >
              <Link
                to="/schedules/$scheduleId"
                params={{ scheduleId: s.id }}
                aria-label={`Open ${s.name}`}
                className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              />

              <div className="min-w-0 flex-1 space-y-2">
                <ScopeIdentity scope={s.scope} />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                    {cadencePhrase(s.cadence)}
                  </span>
                  <span>{shortZone(s.timezone)}</span>
                  {/* Both in the schedule's own zone — they sit beside
                      `cadencePhrase` and the zone name, and the viewer's zone
                      made one row answer in two clocks. */}
                  {!s.paused && s.nextRunAt ? (
                    <span className="tabular-nums">
                      Next {formatTimestamp(s.nextRunAt, s.timezone)}
                    </span>
                  ) : null}
                  <span className="tabular-nums">
                    {s.lastSentAt
                      ? `Last sent ${formatTimestamp(s.lastSentAt, s.timezone)}`
                      : "Not sent yet"}
                  </span>
                </div>
              </div>

              <StatusPill paused={s.paused} />

              <Button
                size="sm"
                variant="ghost"
                className="relative z-10 shrink-0"
                onClick={() => handleToggle(s.id, s.paused)}
                disabled={toggling}
              >
                {s.paused ? (
                  <>
                    <Play className="size-3.5" /> Resume
                  </>
                ) : (
                  <>
                    <Pause className="size-3.5" /> Pause
                  </>
                )}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
