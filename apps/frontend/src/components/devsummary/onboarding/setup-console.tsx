import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, Check, GitBranch, Lock, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  RepositoryIngestStatus,
  RepositoryIngestStatusResponse,
} from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * How long one phase may run before the console stops promising it will finish
 * and offers a way out instead. The CTA is gated on live workflows, so without
 * this a single stuck workflow leaves an admin permanently unable to reach the
 * only action on the page.
 */
const STALLED_MS = 20 * 60_000;

/** Ticks so elapsed times advance between the 3s data polls. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function elapsed(startedAt: string | null, now: number): string | null {
  if (!startedAt) return null;
  const ms = now - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

const num = (n: number) => n.toLocaleString();

function isStalled(repo: RepositoryIngestStatus, now: number): boolean {
  const started = repo.fetching.startedAt ?? repo.analyzing.startedAt;
  if (!started) return false;
  return now - new Date(started).getTime() > STALLED_MS;
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

function Pulse() {
  return (
    <span
      aria-hidden
      className="relative size-1.5 shrink-0 rounded-full bg-brand before:absolute before:-inset-1.5 before:rounded-full before:border-[1.5px] before:border-brand before:content-[''] motion-safe:before:animate-ping"
    />
  );
}

/** Running, total unknown. Never implies a percentage. */
function Sweep({ offset = false }: { offset?: boolean }) {
  return (
    <div className="relative mt-1.5 h-[3px] overflow-hidden rounded-full bg-brand/15">
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-brand to-transparent",
          "motion-safe:animate-[ingest-sweep_1.6s_ease-in-out_infinite] motion-reduce:inset-x-0 motion-reduce:w-full motion-reduce:opacity-45",
          offset && "[animation-delay:550ms]",
        )}
      />
    </div>
  );
}

/** Running, with a real denominator: every fetched commit is a known total. */
function Fill({ ratio }: { ratio: number }) {
  return (
    <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-brand/15">
      <span
        className="block h-full rounded-full bg-brand transition-[width] duration-500"
        style={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%` }}
      />
    </div>
  );
}

function Bar({ tone }: { tone: "idle" | "done" }) {
  return (
    <div
      className={cn(
        "mt-1.5 h-[3px] rounded-full",
        tone === "done" ? "bg-gb-status-shipped/55" : "bg-border",
      )}
    />
  );
}

function CellLabel({
  tone,
  icon,
  children,
}: {
  tone: "muted" | "live" | "done" | "warn";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 font-mono text-[11px] tabular-nums",
        tone === "muted" && "text-muted-foreground",
        tone === "live" && "font-semibold text-brand",
        tone === "done" && "text-gb-status-shipped",
        tone === "warn" && "font-semibold text-gb-status-at-risk",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </div>
  );
}

/* ── the two phase cells ─────────────────────────────────────────────────── */

function FetchingCell({
  repo,
  now,
}: {
  repo: RepositoryIngestStatus;
  now: number;
}) {
  const stalled = isStalled(repo, now);
  const since = elapsed(repo.fetching.startedAt, now);

  if (repo.fetching.state === "running") {
    return (
      <div>
        <CellLabel
          tone={stalled ? "warn" : "live"}
          icon={stalled ? <AlertCircle className="size-3 shrink-0" /> : <Pulse />}
        >
          running{since ? ` · ${since}` : ""}
        </CellLabel>
        <Sweep />
      </div>
    );
  }

  if (repo.fetching.state === "pending") {
    return (
      <div>
        <CellLabel tone="live" icon={<Pulse />}>
          starting
        </CellLabel>
        <Sweep />
      </div>
    );
  }

  return (
    <div>
      <CellLabel tone="done" icon={<Check className="size-3 shrink-0" />}>
        done
      </CellLabel>
      <Bar tone="done" />
    </div>
  );
}

function AnalyzingCell({ repo }: { repo: RepositoryIngestStatus }) {
  const ratio =
    repo.commitCount > 0 ? repo.processedCount / repo.commitCount : 0;
  const counts = `${num(repo.processedCount)} of ${num(repo.commitCount)}`;

  switch (repo.analyzing.state) {
    case "running":
      return (
        <div>
          <CellLabel tone="live" icon={<Pulse />}>
            {counts}
          </CellLabel>
          <Fill ratio={ratio} />
        </div>
      );
    case "waiting":
      return (
        <div>
          <CellLabel tone="muted">
            {repo.commitCount === 0 ? "waiting for commits" : counts}
          </CellLabel>
          <Bar tone="idle" />
        </div>
      );
    // Everything fetched so far is processed, and more is still arriving. Says
    // "idle because it ran out of work", which "0 running" cannot.
    case "caughtUp":
      return (
        <div>
          <CellLabel tone="done">caught up · {counts}</CellLabel>
          <Bar tone="done" />
        </div>
      );
    case "incomplete":
      return (
        <div>
          <CellLabel
            tone="warn"
            icon={<AlertCircle className="size-3 shrink-0" />}
          >
            {counts}
          </CellLabel>
          <Fill ratio={ratio} />
        </div>
      );
    case "done":
      return (
        <div>
          <CellLabel tone="done" icon={<Check className="size-3 shrink-0" />}>
            {counts}
          </CellLabel>
          <Bar tone="done" />
        </div>
      );
  }
}

/* ── the matrix ──────────────────────────────────────────────────────────── */

const COLS =
  "grid grid-cols-1 gap-x-[18px] gap-y-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_180px_96px] lg:gap-y-0";

function Matrix({
  repositories,
  now,
}: {
  repositories: RepositoryIngestStatus[];
  now: number;
}) {
  const totals = repositories.reduce(
    (acc, r) => ({
      commits: acc.commits + r.commitCount,
      processed: acc.processed + r.processedCount,
      skipped: acc.skipped + r.skippedCount,
      running: acc.running + (r.fetching.state === "done" ? 0 : 1),
    }),
    { commits: 0, processed: 0, skipped: 0, running: 0 },
  );

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border bg-card">
      <div
        className={cn(
          COLS,
          "hidden border-b bg-muted px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid",
        )}
      >
        <div>Repository</div>
        <div>Fetching</div>
        <div>Analyzing</div>
        <div className="text-right">Commits</div>
      </div>

      {repositories.map((repo) => (
        <div
          key={repo.repositoryId}
          className={cn(
            COLS,
            "items-center border-b px-4 py-3.5 last:border-b-0",
          )}
        >
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <div className="truncate text-sm font-semibold tracking-tight">
              {repo.fullName}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{repo.branch}</span>
            </div>
          </div>
          <FetchingCell repo={repo} now={now} />
          <AnalyzingCell repo={repo} />
          <div className="font-mono text-sm font-semibold tabular-nums lg:text-right">
            {num(repo.commitCount)}
            <small className="block text-[9.5px] font-normal uppercase tracking-[0.1em] text-muted-foreground">
              {repo.fetching.state === "done" ? "commits" : "so far"}
            </small>
          </div>
        </div>
      ))}

      {repositories.length > 1 ? (
        <div
          className={cn(
            COLS,
            "items-center border-t bg-muted px-4 py-3 font-mono text-xs tabular-nums",
          )}
        >
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground sm:col-span-2 lg:col-span-1">
            Total
          </div>
          <div>
            {totals.running > 0
              ? `${totals.running} of ${repositories.length} running`
              : "done"}
          </div>
          <div>
            {num(totals.processed)} of {num(totals.commits)}
            {totals.skipped > 0 ? ` · ${num(totals.skipped)} skipped` : ""}
          </div>
          <div className="lg:text-right">{num(totals.commits)}</div>
        </div>
      ) : null}
    </div>
  );
}

/* ── the screen ──────────────────────────────────────────────────────────── */

function Steps({ reading }: { reading: boolean }) {
  const steps = [
    { label: "Connected", done: true, now: false },
    { label: reading ? "Reading" : "Read", done: !reading, now: reading },
    { label: "Schedule", done: false, now: !reading },
  ];
  return (
    <div className="mt-6 flex flex-wrap items-center gap-y-1 rounded-xl border bg-card px-4 py-2.5">
      {steps.map((step, i) => (
        <span key={step.label} className="flex items-center">
          {i > 0 ? <span className="mx-3 h-px w-5 bg-border-strong" /> : null}
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs",
              step.now
                ? "font-semibold text-foreground"
                : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "grid size-[17px] place-items-center rounded-full border-[1.5px] font-mono text-[9.5px] font-bold",
                step.done
                  ? "border-gb-status-shipped bg-gb-status-shipped text-card"
                  : step.now
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border-strong",
              )}
            >
              {step.done ? <Check className="size-2.5" /> : i + 1}
            </span>
            {step.label}
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * Full-page setup console for `/briefs`, shown when the org has no schedule and
 * no brief — i.e. when the list would otherwise be empty and the real cause is
 * "nothing is scheduled", not "nothing has happened".
 *
 * It takes the page over here and deliberately not on `/`: this page has nothing
 * to hide, whereas home has the activity charts, which are the one thing that
 * shows the product working. Home gets the compact `NextStepBar` instead.
 *
 * "Create first schedule" is locked while any commit fetch or analysis runs: a
 * schedule created mid-ingest backfills over commits we have not pulled, so its
 * first briefs would cover a partial history. The lock explains itself and
 * releases on its own, since the status query polls every 3s while active.
 */
export function SetupConsole({
  status,
  onGenerate,
}: {
  status: RepositoryIngestStatusResponse;
  onGenerate: () => void;
}) {
  const { repositories, ingesting } = status;
  const now = useNow(ingesting);

  const stalledRepo = repositories.find((r) => isStalled(r, now));
  const totalCommits = repositories.reduce((n, r) => n + r.commitCount, 0);
  const totalSkipped = repositories.reduce((n, r) => n + r.skippedCount, 0);
  const totalProcessed = repositories.reduce((n, r) => n + r.processedCount, 0);

  return (
    <div className="mx-auto max-w-[1060px] pb-10">
      <style>{`@keyframes ingest-sweep { from { left: -40% } to { left: 100% } }`}</style>

      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {ingesting ? "Setting up" : "One step left"}
          </div>
          <h1 className="mt-2.5 max-w-[26ch] text-[28px] font-bold leading-tight tracking-tight text-balance">
            {stalledRepo
              ? "This read is taking longer than usual"
              : ingesting
                ? repositories.length > 1
                  ? `Reading ${repositories.length} repositories`
                  : "Reading your history"
                : "No briefs yet — nothing is scheduled"}
          </h1>
          <p className="mt-2 max-w-[54ch] text-sm text-muted-foreground">
            {stalledRepo ? (
              <>
                Still working on{" "}
                <b className="text-foreground">{stalledRepo.fullName}</b>. Large
                repositories do take this long — a read also sits here if GitHub
                revoked our access.
              </>
            ) : ingesting ? (
              <>
                Pulling in commits, then working out what each one did. Setting a
                schedule is the last step — it&rsquo;s what makes briefs get
                written and sent.
              </>
            ) : (
              <>
                <b className="tabular-nums text-foreground">
                  {num(totalProcessed)}
                </b>{" "}
                of {num(totalCommits)} commits are read and written up. Briefs are
                only produced on a schedule — set one and we&rsquo;ll backfill the
                history you just imported, then keep going on its cadence.
              </>
            )}
          </p>
          {stalledRepo ? (
            <div className="mt-3.5 flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/integrations/github">Check GitHub access</Link>
              </Button>
            </div>
          ) : null}
        </div>

        <div className="max-w-[300px] shrink-0">
          {ingesting ? (
            <>
              <span
                aria-disabled="true"
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-[9px] border border-dashed border-border-strong px-[15px] py-[9px] text-[13px] font-semibold text-muted-foreground"
              >
                <Lock className="size-3.5" /> Create first schedule
              </span>
              <p className="mt-2.5 flex gap-2 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0 text-gb-status-at-risk" />
                <span>
                  {stalledRepo
                    ? "Still locked while that row runs. If access broke, fixing it on the GitHub page clears this."
                    : "Opens when both columns clear. A schedule made now would backfill over commits we haven’t pulled yet."}
                </span>
              </p>
              {stalledRepo ? null : (
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  unlocks automatically
                </p>
              )}
            </>
          ) : (
            <>
              <Button asChild>
                <Link to="/schedules/new">
                  Create first schedule <ArrowRight className="size-3.5" />
                </Link>
              </Button>
              <p className="mt-2.5">
                <button
                  type="button"
                  onClick={onGenerate}
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground"
                >
                  <Zap className="size-3" /> Generate one brief instead
                </button>
              </p>
            </>
          )}
        </div>
      </div>

      <Steps reading={ingesting} />
      <Matrix repositories={repositories} now={now} />

      <p className="mt-4 text-xs text-muted-foreground">
        {ingesting
          ? "Close the tab — this keeps running, and picks up where it left off."
          : totalSkipped > 0
            ? `${num(totalSkipped)} merge commits were skipped — they carry no changes of their own.`
            : "A schedule turns this into one brief per period, written for stakeholders and delivered to them."}
      </p>
    </div>
  );
}
