import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, CalendarClock, Lock, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * What the bar has to say, resolved by `useNextStep`. One row, every state — it
 * sits above Activity on `/` rather than replacing the page, because the charts
 * are the reason the user came and hiding them to explain a missing schedule
 * trades the wrong thing away.
 */
export type NextStep =
  | {
      kind: "ingesting";
      /** Repositories still fetching, of the total tracked. */
      fetchingRepos: number;
      totalRepos: number;
      /** Commits with an analysis row, of those pulled so far. */
      processed: number;
      commits: number;
      /** True while any fetch runs — no denominator exists then, so no fill. */
      anyFetching: boolean;
      /** ISO start of the oldest running phase, for elapsed time. */
      startedAt: string | null;
      /** The repository that start belongs to, named if the wait goes long. */
      oldestRepo: string | null;
    }
  | { kind: "schedule"; processed: number; commits: number; skipped: number }
  | { kind: "writing"; scheduleName: string }
  | { kind: "viewer"; orgName?: string };

/** Ticks so elapsed time advances between the 3s data polls. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function elapsedLabel(startedAt: string | null, now: number): string | null {
  if (!startedAt) return null;
  const ms = now - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  if (minutes === 0) return `${total}s`;
  return `${minutes}m`;
}

const num = (n: number) => n.toLocaleString();

/** How long a phase may run before the bar offers a way out instead of a promise. */
const STALLED_MS = 20 * 60_000;

function Shell({
  tone = "brand",
  icon,
  title,
  detail,
  actions,
  progress,
}: {
  tone?: "brand" | "muted" | "warn";
  icon: React.ReactNode;
  title: React.ReactNode;
  detail: React.ReactNode;
  actions?: React.ReactNode;
  /** Hairline along the bottom edge: `null` = none, `-1` = indeterminate. */
  progress?: number | null;
}) {
  return (
    <div className="relative mb-[18px] flex flex-wrap items-center gap-3.5 overflow-hidden rounded-2xl border border-border-strong bg-card px-4 py-3 shadow-e1">
      <span
        className={cn(
          "grid size-[30px] shrink-0 place-items-center rounded-[9px]",
          tone === "brand" && "bg-brand/12 text-brand",
          tone === "muted" && "bg-muted text-muted-foreground",
          tone === "warn" && "bg-gb-status-at-risk/12 text-gb-status-at-risk",
        )}
      >
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold tracking-tight">{title}</div>
        <div className="mt-px text-[12.5px] text-muted-foreground">{detail}</div>
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2 max-[720px]:w-full max-[720px]:*:flex-1">
          {actions}
        </div>
      ) : null}

      {progress === null || progress === undefined ? null : progress < 0 ? (
        <span className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-brand/15">
          <span
            aria-hidden
            className="absolute inset-y-0 w-2/5 bg-gradient-to-r from-transparent via-brand to-transparent motion-safe:animate-[next-step-sweep_1.6s_ease-in-out_infinite] motion-reduce:inset-x-0 motion-reduce:w-full motion-reduce:opacity-45"
          />
        </span>
      ) : (
        <span className="absolute inset-x-0 bottom-0 h-[2px] bg-brand/15">
          <span
            className="block h-full bg-brand transition-[width] duration-500"
            style={{ width: `${Math.min(100, Math.max(2, progress * 100))}%` }}
          />
        </span>
      )}
    </div>
  );
}

/** Locked while a commit fetch or analysis runs — see `useNextStep`. */
function LockedCta() {
  return (
    <span
      aria-disabled="true"
      className="inline-flex cursor-not-allowed items-center gap-2 rounded-[9px] border border-dashed border-border-strong px-3.5 py-2 text-[13px] font-semibold text-muted-foreground"
    >
      <Lock className="size-3.5" /> Create first schedule
    </span>
  );
}

export function NextStepBar({ step }: { step: NextStep }) {
  const now = useNow(step.kind === "ingesting");

  // Keyframes live here rather than index.css: this is the only user, and the
  // bar is the only place an indeterminate sweep appears.
  const sweepKeyframes = (
    <style>{`@keyframes next-step-sweep { from { left: -40% } to { left: 100% } }`}</style>
  );

  if (step.kind === "ingesting") {
    const since = elapsedLabel(step.startedAt, now);
    const ratio = step.commits > 0 ? step.processed / step.commits : 0;

    // Decided here, not in the hook: `now` ticks every second, so the switch to
    // the recovery message happens on time rather than on the next data poll.
    // A gated CTA must never dead-end — one stuck workflow would otherwise leave
    // an admin with a permanently locked button and no way forward.
    const stalledRepo =
      step.oldestRepo !== null &&
      step.startedAt !== null &&
      now - new Date(step.startedAt).getTime() > STALLED_MS
        ? step.oldestRepo
        : null;

    if (stalledRepo) {
      return (
        <>
          {sweepKeyframes}
          <Shell
            tone="warn"
            icon={<AlertCircle className="size-[15px]" />}
            title="This read is taking longer than usual"
            detail={
              <>
                Still working on{" "}
                <span className="font-mono">{stalledRepo}</span>
                {since ? ` · ${since}` : ""}. Large repositories do take this
                long — a read also sits here if GitHub revoked our access.
              </>
            }
            actions={
              <>
                <Button asChild size="sm" variant="outline">
                  <Link to="/integrations/github">Check GitHub access</Link>
                </Button>
                <LockedCta />
              </>
            }
            progress={-1}
          />
        </>
      );
    }

    return (
      <>
        {sweepKeyframes}
        <Shell
          icon={<CalendarClock className="size-[15px]" />}
          title="Reading your history — a schedule is the last step"
          detail={
            <>
              {step.anyFetching ? (
                <>
                  Fetching{" "}
                  <span className="tabular-nums">
                    {step.fetchingRepos} of {step.totalRepos}
                  </span>{" "}
                  {step.totalRepos === 1 ? "repository" : "repositories"}
                </>
              ) : (
                <>
                  Writing up{" "}
                  <span className="tabular-nums">
                    {num(step.processed)} of {num(step.commits)}
                  </span>{" "}
                  commits
                </>
              )}
              {since ? ` · ${since}` : ""} · the button opens when this finishes,
              so your first briefs cover everything.
            </>
          }
          actions={<LockedCta />}
          // Sweep while fetching (no total exists until it ends), real fill once
          // only analysis remains — every pulled commit is then a denominator.
          progress={step.anyFetching ? -1 : ratio}
        />
      </>
    );
  }

  if (step.kind === "schedule") {
    return (
      <Shell
        icon={<CalendarClock className="size-[15px]" />}
        title="Nothing is scheduled, so no briefs will be written"
        detail={
          <>
            <span className="tabular-nums">{num(step.processed)}</span> commits
            are read and ready
            {step.skipped > 0 ? (
              <>
                {" "}
                (
                <span className="tabular-nums">{num(step.skipped)}</span> merge
                commits skipped)
              </>
            ) : null}
            . Set a schedule and we&rsquo;ll backfill them, then keep going on
            its cadence.
          </>
        }
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link
                to="/briefs"
                search={{
                  filterType: "all",
                  from: "",
                  to: "",
                  scopeId: "",
                  excludeNoActivity: false,
                  page: 0,
                }}
              >
                <Zap className="size-3" /> Generate one
              </Link>
            </Button>
            <Button asChild>
              <Link to="/schedules/new">
                Create first schedule <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </>
        }
      />
    );
  }

  if (step.kind === "writing") {
    return (
      <Shell
        icon={<CalendarClock className="size-[15px]" />}
        title={`${step.scheduleName} is writing your first briefs`}
        detail="They'll appear under Briefs as they're written — nothing else to do."
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link
              to="/briefs"
              search={{
                filterType: "all",
                from: "",
                to: "",
                scopeId: "",
                excludeNoActivity: false,
                page: 0,
              }}
            >
              View briefs
            </Link>
          </Button>
        }
        progress={-1}
      />
    );
  }

  return (
    <>
      {sweepKeyframes}
      <Shell
        tone="muted"
        icon={<Lock className="size-[15px]" />}
        title="No briefs are scheduled yet"
        detail={
          <>
            Only owners or admins
            {step.orgName ? (
              <>
                {" "}
                of <b>{step.orgName}</b>
              </>
            ) : null}{" "}
            can set a schedule up. Briefs land here once they do.
          </>
        }
      />
    </>
  );
}
