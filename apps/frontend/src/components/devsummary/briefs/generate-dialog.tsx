import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import type {
  BriefPreviewQuery,
  DeliveryInput,
  ScopeInput,
} from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionLabel } from "@/components/devsummary/shared/section-label";
import { extractErrorMessage } from "@/components/devsummary/shared/error-state";
import { ScopePicker } from "@/components/devsummary/schedules/scope-picker";
import { DeliveryFields } from "@/components/devsummary/schedules/delivery-fields";
import { CommitTypeBar } from "@/components/devsummary/briefs/commit-type-bar";
import { formatRange } from "@/components/devsummary/briefs/brief-utils";
import { useBriefPreview, useGenerateBrief } from "@/hooks/api/use-briefs";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";
import { useGetProjects } from "@/hooks/api/use-projects";
import { formatTimestamp } from "@/lib/cadence-label";
import { cn } from "@/lib/utils";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";
import {
  GENERATE_BLOCKED_REASON,
  useCommitsProcessing,
} from "@/hooks/use-commits-processing";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The zone the brief's days are tiled and labelled in. Defaults to the
 * viewer's, which is what someone generating a brief for themselves means, but
 * stays editable — an ops lead in Berlin reporting on a Bangalore team wants
 * the team's days, not their own.
 */
function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Module scope: the list is static, and rebuilding ~400 strings per render is waste. */
const TIMEZONES: string[] = (() => {
  type SupportedValues = (kind: "timeZone") => string[];
  const intl = Intl as unknown as { supportedValuesOf?: SupportedValues };
  const all = intl.supportedValuesOf?.("timeZone");
  if (!all?.length) return [browserTimezone()];
  // The viewer's own zone can be a CLDR spelling absent from the list
  // (`Asia/Calcutta` vs `Asia/Kolkata`); without this the Select renders blank
  // on open because its value matches no item.
  return all.includes(browserTimezone()) ? all : [browserTimezone(), ...all];
})();

/**
 * 30/90 is already the product's history vocabulary (the GitHub setup history
 * window), so the presets stay in that language rather than inventing a
 * "sprint" the product has no concept of. 90 is also the ceiling everywhere
 * else, which is why nothing here reaches past it.
 */
const PRESETS = [
  { id: "1d", label: "24h", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "custom", label: "Custom", days: null },
] as const;

type PresetId = (typeof PRESETS)[number]["id"];

function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toPreviewQuery(
  scope: ScopeInput,
  period: { start: string; end: string },
): BriefPreviewQuery {
  const base = { periodStart: period.start, periodEnd: period.end };
  if (scope.type === "project")
    return { ...base, scopeType: "project", scopeProjectId: scope.projectId };
  if (scope.type === "team")
    return { ...base, scopeType: "team", scopeTeamId: scope.teamId };
  if (scope.type === "collaborator")
    return {
      ...base,
      scopeType: "collaborator",
      scopeCollaboratorId: scope.collaboratorId,
    };
  return {
    ...base,
    scopeType: "repository",
    scopeRepositoryId: scope.repositoryId,
    branch: scope.branch,
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </>
  );
}

export function GenerateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  const projectsQuery = useGetProjects();
  const installationsQuery = useGithubInstallations();
  const generateMutation = useGenerateBrief();
  // Mirrors the server's gate on the same flag (409 BRIEF_COMMITS_PROCESSING).
  const blocked = useCommitsProcessing();

  const [scope, setScope] = useState<ScopeInput | null>(null);
  const [preset, setPreset] = useState<PresetId>("7d");
  /**
   * "Now", frozen when the dialog opens. A live `Date.now()` would change the
   * preview's query key on every render and refetch forever.
   */
  const [anchor, setAnchor] = useState(() => Date.now());
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [timezone, setTimezone] = useState<string>(browserTimezone);
  const [delivery, setDelivery] = useState<DeliveryInput>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // A scope points at org-owned entities, so it can't outlive an org switch —
  // drop it and let the default-select effect below pick one from the new org.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScope(null);
  }, [activeOrgId]);

  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnchor(now);
    setPreset("7d");
    setSubmitError(null);
    setTimezone(browserTimezone());
    setDelivery({});
    setCustomStart(toLocalIso(new Date(now - 7 * DAY_MS)));
    setCustomEnd(toLocalIso(new Date(now)));
    if (!scope) {
      const firstProjectId = projectsQuery.data?.data[0]?.id;
      if (firstProjectId)
        setScope({ type: "project", projectId: firstProjectId });
    }
  }, [open, projectsQuery.data, scope]);

  const period = useMemo(() => {
    if (preset === "custom") {
      const start = new Date(customStart);
      const end = new Date(customEnd);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
        return null;
      if (end.getTime() <= start.getTime()) return null;
      return { start: start.toISOString(), end: end.toISOString() };
    }
    const days = PRESETS.find((p) => p.id === preset)?.days ?? 7;
    return {
      start: new Date(anchor - days * DAY_MS).toISOString(),
      end: new Date(anchor).toISOString(),
    };
  }, [preset, anchor, customStart, customEnd]);

  const previewQuery = useMemo(
    () => (open && scope && period ? toPreviewQuery(scope, period) : null),
    [open, scope, period],
  );
  const preview = useBriefPreview(previewQuery);
  const previewData = preview.data?.data;

  const slackAvailable = (installationsQuery.data?.data ?? []).length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (blocked) {
      setSubmitError(GENERATE_BLOCKED_REASON);
      return;
    }
    if (!scope) {
      setSubmitError("Pick a scope before generating.");
      return;
    }
    if (!period) {
      setSubmitError("End must be after start.");
      return;
    }
    try {
      // The period is always explicit, so the brief covers exactly the window
      // the preview counted — letting the server default it would re-anchor
      // "now" and quietly disagree with the number on the button.
      const res = await generateMutation.mutateAsync({
        scope,
        delivery,
        periodStart: period.start,
        periodEnd: period.end,
        timezone,
      });
      toast.success("Brief generation enqueued");
      onOpenChange(false);
      await navigate({
        to: "/briefs/$briefId",
        params: { briefId: res.data.briefId },
      });
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    }
  };

  const empty = previewData?.commits === 0;
  const generateLabel = previewData
    ? previewData.commits > 0
      ? `Generate from ${previewData.commits} commit${previewData.commits === 1 ? "" : "s"}`
      : "Generate anyway"
    : "Generate";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Generate brief now</DialogTitle>
            <DialogDescription>
              Pick a scope and a period — we'll show you what's in it before you
              generate.
            </DialogDescription>
          </DialogHeader>

          {previewData?.recentBrief ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
              <span>
                A brief for this scope,{" "}
                <span className="font-medium">
                  {formatRange(
                    previewData.recentBrief.periodStart,
                    previewData.recentBrief.periodEnd,
                    previewData.recentBrief.periodTimezone,
                  )}
                </span>
                , was generated {formatTimestamp(previewData.recentBrief.createdAt)}.
              </span>
              <Button asChild size="sm" variant="outline">
                <Link
                  to="/briefs/$briefId"
                  params={{ briefId: previewData.recentBrief.id }}
                  onClick={() => onOpenChange(false)}
                >
                  Open it
                </Link>
              </Button>
            </div>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-[1fr_15rem]">
            <div className="space-y-5">
              <section>
                <SectionLabel className="mb-2">Scope</SectionLabel>
                <ScopePicker value={scope} onChange={setScope} />
              </section>

              <section>
                <SectionLabel className="mb-2">Period</SectionLabel>
                <div className="grid grid-cols-3 gap-1 rounded-2xl border bg-card p-1 sm:grid-cols-5 sm:rounded-full">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPreset(p.id)}
                      aria-pressed={preset === p.id}
                      className={cn(
                        "rounded-xl px-3 py-1.5 text-xs font-medium transition sm:rounded-full",
                        preset === p.id
                          ? "bg-brand/12 text-brand"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {preset === "custom" ? (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="period-start" className="text-xs">
                        Start
                      </Label>
                      <Input
                        id="period-start"
                        type="datetime-local"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="period-end" className="text-xs">
                        End
                      </Label>
                      <Input
                        id="period-end"
                        type="datetime-local"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="mt-3">
                  <Label htmlFor="brief-tz" className="text-xs">
                    Timezone
                  </Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger id="brief-tz" className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Days in this brief start and end at midnight here.
                  </p>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  {period
                    ? formatRange(period.start, period.end, timezone)
                    : "End must be after start."}
                  {previewData?.historyFrom
                    ? ` · history available from ${new Date(previewData.historyFrom).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                    : ""}
                </p>
              </section>

              {empty ? (
                <div className="flex gap-2.5 rounded-lg border border-gb-status-at-risk/45 bg-gb-status-at-risk/10 px-3 py-2.5 text-xs">
                  <AlertTriangle className="mt-px size-3.5 shrink-0 text-gb-status-at-risk" />
                  <span>
                    <span className="font-medium">No commits in this period.</span>{" "}
                    Generating now produces a “no activity” brief.
                    {previewData?.historyTo
                      ? ` The last commit in this scope was ${new Date(previewData.historyTo).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.`
                      : ""}
                  </span>
                </div>
              ) : null}

              <section>
                <SectionLabel className="mb-2">Delivery</SectionLabel>
                <DeliveryFields
                  delivery={delivery}
                  onChange={setDelivery}
                  slackAvailable={slackAvailable}
                />
              </section>
            </div>

            <aside className="space-y-3 sm:border-l sm:pl-5">
              <SectionLabel>In this period</SectionLabel>

              {!previewQuery ? (
                <p className="text-xs text-muted-foreground">
                  Pick a scope to see what it covers.
                </p>
              ) : preview.isError ? (
                <div className="space-y-2">
                  <p className="text-xs text-destructive">
                    Couldn't load the preview.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void preview.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : preview.isPending || !previewData ? (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2 w-full rounded-full" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ) : (
                <div
                  className={cn(
                    "space-y-3 transition-opacity",
                    preview.isPlaceholderData && "opacity-50",
                  )}
                >
                  <div>
                    <div
                      className={cn(
                        "text-2xl font-bold tabular-nums tracking-tight",
                        previewData.commits === 0 && "text-muted-foreground",
                      )}
                    >
                      {previewData.commits}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      commits · {previewData.contributors} contributor
                      {previewData.contributors === 1 ? "" : "s"}
                    </p>
                  </div>

                  <CommitTypeBar counts={previewData.commitTypeCounts} />

                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
                    <Stat
                      label="Repos"
                      value={String(previewData.repositories)}
                    />
                    <Stat
                      label="Analysed"
                      value={`${previewData.analyzed} / ${previewData.commits}`}
                    />
                    <Stat
                      label="Est. cost"
                      value={
                        previewData.commits === 0 ? "none" : "~1 LLM call"
                      }
                    />
                  </dl>

                  {previewData.analyzed < previewData.commits ? (
                    <p className="text-xs text-muted-foreground">
                      Some commits are still being analysed — the brief will
                      cover them with less detail.
                    </p>
                  ) : null}
                </div>
              )}
            </aside>
          </div>

          {submitError ? (
            <p className="text-xs text-destructive">{submitError}</p>
          ) : null}

          {blocked ? (
            <p className="text-xs text-muted-foreground">
              {GENERATE_BLOCKED_REASON}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {/* The tooltip lives on the wrapper: a disabled button fires no
                mouse events, so `title` on it never shows. */}
            <span
              title={blocked ? GENERATE_BLOCKED_REASON : undefined}
              className="inline-flex"
            >
              <Button
                type="submit"
                variant={empty ? "outline" : "default"}
                disabled={
                  generateMutation.isPending || !scope || !period || blocked
                }
              >
                {generateMutation.isPending ? "Enqueueing…" : generateLabel}
              </Button>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
