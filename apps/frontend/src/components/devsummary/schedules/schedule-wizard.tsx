import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Pencil } from "lucide-react";
import { toast } from "sonner";
import type {
  BriefScheduleResponse,
  CadenceInput,
  ScopeInput,
} from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";
import {
  cadencePhrase,
  formatRunAt,
  shortZone,
} from "@/lib/cadence-label";
import { deriveScopeName } from "@/lib/scope-name";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractErrorMessage } from "@/components/devsummary/shared/error-state";
import { ScopePicker } from "./scope-picker";
import { CadenceFields } from "./cadence-fields";
import { useCreateBriefSchedule } from "@/hooks/api/use-brief-schedules";
import { useGetProjects } from "@/hooks/api/use-projects";
import { useGetTeams } from "@/hooks/api/use-teams";
import { useGetCollaborators } from "@/hooks/api/use-collaborators";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";
import { useCommitsProcessing } from "@/hooks/use-commits-processing";
import { SCHEDULE_BLOCKED_REASON } from "./new-schedule-button";

type Stage = 1 | 2 | 3;

const STAGES: { n: Stage; label: string }[] = [
  { n: 1, label: "Cover" },
  { n: 2, label: "When" },
  { n: 3, label: "History & review" },
];

/**
 * Three months is the top choice because `MAX_HISTORY_DAYS` (90) is the
 * ceiling on history everywhere — the server clamps a wider window anyway, and
 * nothing older than that was ingested to summarize.
 */
const BACKFILL_CHOICES: { months: number; label: string }[] = [
  { months: 0, label: "None" },
  { months: 1, label: "1 month" },
  { months: 3, label: "3 months" },
];

const monthsLabel = (months: number) =>
  `${months} month${months === 1 ? "" : "s"}`;

/**
 * Briefs per month of history, by cadence. Only ever an upper bound: the
 * backfill planner stops at the window holding the newest commit and skips
 * windows a brief already exists for, so a quiet repo produces fewer.
 */
const BRIEFS_PER_MONTH: Record<CadenceInput["type"], number> = {
  daily: 30,
  weekly: 4,
  monthly: 1,
};

function scopeEntityId(scope: ScopeInput): string {
  if (scope.type === "project") return scope.projectId;
  if (scope.type === "team") return scope.teamId;
  if (scope.type === "collaborator") return scope.collaboratorId;
  return scope.repositoryId;
}

function defaultTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition",
        active
          ? "bg-brand/12 text-brand"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Stepper({
  stage,
  onJump,
}: {
  stage: Stage;
  onJump: (to: Stage) => void;
}) {
  return (
    <div className="mb-5 flex items-center gap-2">
      {STAGES.map(({ n, label }, i) => {
        const complete = stage > n;
        const current = stage === n;
        return (
          <div key={n} className="flex min-w-0 items-center gap-2">
            {i > 0 ? <span className="h-px w-6 shrink-0 bg-border sm:w-10" /> : null}
            <button
              type="button"
              onClick={() => onJump(n)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs transition hover:bg-muted/60",
                current ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border text-[0.6rem] font-bold",
                  complete
                    ? "border-transparent bg-gb-status-shipped/16 text-gb-status-shipped"
                    : current
                      ? "border-brand bg-brand text-brand-foreground"
                      : "border-border-strong",
                )}
              >
                {complete ? <Check className="size-3" /> : n}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function StageHeading({
  title,
  description,
  optional,
}: {
  title: string;
  description: string;
  optional?: boolean;
}) {
  return (
    <div className="mb-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        {title}
        {optional ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
            optional
          </span>
        ) : null}
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ReviewRow({
  label,
  children,
  onEdit,
  highlight,
}: {
  label: string;
  children: React.ReactNode;
  onEdit?: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-3 border-t px-3.5 py-2.5 text-sm first:border-t-0",
        highlight && "bg-brand/6",
      )}
    >
      <span className="w-24 shrink-0 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {onEdit ? (
        <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      ) : null}
    </div>
  );
}

export function ScheduleWizard() {
  const navigate = useNavigate();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);

  const projectsQuery = useGetProjects();
  const teamsQuery = useGetTeams();
  const collaboratorsQuery = useGetCollaborators();
  const installationsQuery = useGithubInstallations();
  // Named, not the raw `C0123ABCDEF` — the review row is the last thing read
  // before Create, and an id proves nothing about where the brief lands.

  const [stage, setStage] = useState<Stage>(1);
  const [created, setCreated] = useState<BriefScheduleResponse | null>(null);

  const [scope, setScope] = useState<ScopeInput | null>(null);
  const [cadence, setCadence] = useState<CadenceInput>({
    type: "weekly",
    time: "09:00",
    dayOfWeek: 1,
  });
  const [timezone, setTimezone] = useState<string>(defaultTz());
  const [backfillMonths, setBackfillMonths] = useState(3);
  const [name, setName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createMutation = useCreateBriefSchedule();
  // Mirrors the server's own gate: creating now would backfill briefs over a
  // history still being read, and no brief is ever regenerated.
  const blocked = useCommitsProcessing();

  // A scope picked under the previous org points at entities the new org does
  // not own, so drop it and let the effect below re-select.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScope(null);
  }, [activeOrgId]);

  useEffect(() => {
    if (scope) return;
    const firstProjectId = projectsQuery.data?.data[0]?.id;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (firstProjectId) setScope({ type: "project", projectId: firstProjectId });
  }, [scope, projectsQuery.data]);

  useEffect(() => {
    if (nameDirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(
      deriveScopeName(
        scope,
        projectsQuery.data?.data ?? [],
        teamsQuery.data?.data ?? [],
        (collaboratorsQuery.data?.data ?? []).map((c) => ({
          id: c.id,
          login: c.login,
        })),
        (installationsQuery.data?.data ?? []).flatMap((i) =>
          i.repositories.map((r) => ({ id: r.id, fullName: r.fullName })),
        ),
        cadence.type,
      ),
    );
  }, [
    nameDirty,
    scope,
    cadence.type,
    projectsQuery.data,
    teamsQuery.data,
    collaboratorsQuery.data,
    installationsQuery.data,
  ]);

  const scopeName = deriveScopeName(
    scope,
    projectsQuery.data?.data ?? [],
    teamsQuery.data?.data ?? [],
    (collaboratorsQuery.data?.data ?? []).map((c) => ({
      id: c.id,
      login: c.login,
    })),
    (installationsQuery.data?.data ?? []).flatMap((i) =>
      i.repositories.map((r) => ({ id: r.id, fullName: r.fullName })),
    ),
    cadence.type,
  );

  const backfillEstimate = BRIEFS_PER_MONTH[cadence.type] * backfillMonths;

  const goTo = (to: Stage) => {
    if (to > 1 && !scope) {
      setScopeError(true);
      setStage(1);
      return;
    }
    setScopeError(false);
    setSubmitError(null);
    setStage(to);
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    if (blocked) {
      setSubmitError(SCHEDULE_BLOCKED_REASON);
      return;
    }
    if (!scope) {
      setScopeError(true);
      setStage(1);
      return;
    }
    try {
      const response = await createMutation.mutateAsync({
        name: name.trim() || "New brief",
        cadence,
        timezone,
        scope,
        backfillMonths,
      });
      setCreated(response.data);
      toast.success("Schedule created");
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    }
  };

  if (created) {
    return (
      <>
        <Card className="block p-6 text-center">
          <div className="mx-auto grid size-11 place-items-center rounded-full bg-gb-status-shipped/16 text-gb-status-shipped">
            <Check className="size-5" />
          </div>
          <h2 className="mt-3 text-lg font-semibold tracking-tight">
            {created.name} is live
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            First brief lands{" "}
            <span className="font-semibold text-foreground">
              {formatRunAt(created.nextRunAt, created.timezone)}
            </span>{" "}
            ({shortZone(created.timezone)}).{" "}
            {backfillMonths > 0
              ? `Briefs for the last ${monthsLabel(backfillMonths)} are generating now — the dashboard fills in over the next few minutes.`
              : "No past briefs were generated."}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button asChild size="sm">
              <Link
                to="/briefs"
                search={{
                  filterType: created.scope.type,
                  scopeId: scopeEntityId(created.scope),
                  from: "",
                  to: "",
                  excludeNoActivity: false,
                  page: 0,
                }}
              >
                View briefs
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/schedules">Back to schedules</Link>
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-muted-foreground">Name</span>
        {editingName ? (
          <Input
            autoFocus
            className="max-w-xs"
            value={name}
            maxLength={200}
            onChange={(e) => {
              setName(e.target.value);
              setNameDirty(true);
            }}
            onBlur={() => setEditingName(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setEditingName(false);
              }
            }}
          />
        ) : (
          <>
            <span className="font-semibold">{name}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditingName(true)}
            >
              <Pencil className="size-3" /> Edit
            </Button>
            {nameDirty ? null : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
                auto
              </span>
            )}
          </>
        )}
      </div>

      <Stepper stage={stage} onJump={goTo} />

      <Card className="block p-6">
        {stage === 1 ? (
          <>
            <StageHeading
              title="What should these briefs cover?"
              description="Every brief summarises the commits inside one scope. You can change it later."
            />
            <ScopePicker value={scope} onChange={setScope} />
            {scopeError ? (
              <p className="mt-3 text-sm text-destructive">
                Pick something for the brief to cover before continuing.
              </p>
            ) : null}
          </>
        ) : stage === 2 ? (
          <>
            <StageHeading
              title="How often should it go out?"
              description="Each brief covers the commits from the period that just ended."
            />
            <CadenceFields
              cadence={cadence}
              timezone={timezone}
              onCadenceChange={setCadence}
              onTimezoneChange={setTimezone}
            />
          </>
        ) : (
          <>
            <StageHeading
              title="How far back should it go?"
              description="Briefs appear on the dashboard, and land as a desktop notification when those are on."
              optional
            />

            <div>
              <Label className="text-xs">Generate past briefs now</Label>
              <div className="mt-2 flex w-full gap-1 rounded-full border bg-card p-1">
                {BACKFILL_CHOICES.map(({ months, label }) => (
                  <SegButton
                    key={months}
                    active={backfillMonths === months}
                    onClick={() => setBackfillMonths(months)}
                  >
                    {label}
                  </SegButton>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {backfillMonths === 0
                  ? "Nothing is generated for the past — your first brief is the one below."
                  : `Up to ${backfillEstimate} ${cadence.type} briefs for the last ${monthsLabel(backfillMonths)}, generated in the background. Each one is an AI call, so this is the only part of the form that costs anything up front.`}
              </p>
            </div>

            <div className="mt-6">
              <Label className="text-xs">Review</Label>
              <div className="mt-2 overflow-hidden rounded-xl border bg-card">
                <ReviewRow label="Name">
                  <span className="font-medium">{name}</span>
                </ReviewRow>
                <ReviewRow label="Covers" onEdit={() => goTo(1)}>
                  {scope ? (
                    <>
                      <span className="font-medium">{scopeName}</span>{" "}
                      <span className="text-xs text-muted-foreground">
                        {scope.type === "collaborator" ? "person" : scope.type}
                      </span>
                    </>
                  ) : (
                    <span className="text-destructive">nothing picked</span>
                  )}
                </ReviewRow>
                <ReviewRow label="Schedule" onEdit={() => goTo(2)} highlight>
                  <span className="font-medium">{cadencePhrase(cadence)}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {shortZone(timezone)} time
                  </span>
                </ReviewRow>
                <ReviewRow label="Past briefs">
                  {backfillMonths === 0
                    ? "None"
                    : `Up to ${backfillEstimate} · ${monthsLabel(backfillMonths)} of history`}
                </ReviewRow>
              </div>
            </div>
          </>
        )}

        {submitError ? (
          <p className="mt-4 text-sm text-destructive">{submitError}</p>
        ) : null}

        {blocked && stage === 3 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {SCHEDULE_BLOCKED_REASON}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {scope ? (
              <>
                <span className="font-medium text-foreground">{scopeName}</span>
                {stage >= 2 ? (
                  <>
                    {" · "}
                    <span className="font-medium text-foreground">
                      {cadencePhrase(cadence)}
                    </span>
                  </>
                ) : null}
                {stage >= 3 && backfillMonths > 0 ? (
                  <> {`· up to ${backfillEstimate} past`}</>
                ) : null}
              </>
            ) : (
              <span className="text-destructive">No scope picked</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            {stage === 1 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate({ to: "/schedules" })}
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={() => goTo((stage - 1) as Stage)}
              >
                <ArrowLeft className="size-3.5" /> Back
              </Button>
            )}
            {stage < 3 ? (
              <Button type="button" onClick={() => goTo((stage + 1) as Stage)}>
                Continue <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              // The tooltip lives on the wrapper: a disabled button fires no
              // mouse events, so `title` on it never shows.
              <span
                title={blocked ? SCHEDULE_BLOCKED_REASON : undefined}
                className="inline-flex"
              >
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={createMutation.isPending || blocked}
                >
                  {createMutation.isPending ? "Creating…" : "Create schedule"}
                </Button>
              </span>
            )}
          </div>
        </div>
      </Card>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        Nothing is saved until the last stage. The steps above are clickable —
        jump straight to review if you already know what you want.
      </p>
    </>
  );
}
