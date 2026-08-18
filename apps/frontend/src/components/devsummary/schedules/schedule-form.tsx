import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type {
  BriefScheduleResponse,
  CadenceInput,
  DeliveryInput,
  ScopeInput,
} from "@launchstack/api-interfaces";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  extractErrorMessage,
} from "@/components/devsummary/shared/error-state";
import { ScopePicker, deriveScopeName } from "./scope-picker";
import { CadenceFields } from "./cadence-fields";
import { DeliveryFields } from "./delivery-fields";
import { useUpdateBriefSchedule } from "@/hooks/api/use-brief-schedules";
import { useGetProjects } from "@/hooks/api/use-projects";
import { useGetTeams } from "@/hooks/api/use-teams";
import { useGetCollaborators } from "@/hooks/api/use-collaborators";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";
import { useSlackAvailable } from "@/hooks/api/use-slack";

function scopeFromExisting(existing: BriefScheduleResponse): ScopeInput {
  return existing.scope as ScopeInput;
}

function cadenceFromExisting(existing: BriefScheduleResponse): CadenceInput {
  if (existing.cadence.type === "daily")
    return { type: "daily", time: existing.cadence.time.slice(0, 5) };
  if (existing.cadence.type === "weekly")
    return {
      type: "weekly",
      time: existing.cadence.time.slice(0, 5),
      dayOfWeek: existing.cadence.dayOfWeek,
    };
  return {
    type: "monthly",
    time: existing.cadence.time.slice(0, 5),
    dayOfMonth: existing.cadence.dayOfMonth,
  };
}

function deliveryFromExisting(existing: BriefScheduleResponse): DeliveryInput {
  return {
    emails: existing.delivery.emails,
    slackChannelId: existing.delivery.slackChannelId ?? undefined,
  };
}

/**
 * Edit form for an existing schedule — one screen, every field visible.
 * Creation is the staged flow in `schedule-wizard.tsx`: it has a backfill choice
 * and a success stage, neither of which means anything for an edit.
 */
export function ScheduleForm({
  existing,
}: {
  existing: BriefScheduleResponse;
}) {
  const navigate = useNavigate();

  const projectsQuery = useGetProjects();
  const teamsQuery = useGetTeams();
  const collaboratorsQuery = useGetCollaborators();
  const installationsQuery = useGithubInstallations();
  const slackAvailable = useSlackAvailable();

  const [scope, setScope] = useState<ScopeInput | null>(
    scopeFromExisting(existing),
  );
  const [cadence, setCadence] = useState<CadenceInput>(
    cadenceFromExisting(existing),
  );
  const [timezone, setTimezone] = useState<string>(existing.timezone);
  const [delivery, setDelivery] = useState<DeliveryInput>(
    deliveryFromExisting(existing),
  );
  const [name, setName] = useState(existing.name);
  const [nameDirty, setNameDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const updateMutation = useUpdateBriefSchedule(existing.id);
  const submitting = updateMutation.isPending;

  useEffect(() => {
    if (nameDirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(
      deriveScopeName(
        scope,
        projectsQuery.data?.data ?? [],
        teamsQuery.data?.data ?? [],
        (collaboratorsQuery.data?.data ?? []).map((c) => ({ id: c.id, login: c.login })),
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!scope) {
      setSubmitError("Pick a scope before saving.");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        name: name.trim() || "New brief",
        cadence,
        timezone,
        scope,
        delivery: {
          emails: delivery.emails ?? [],
          slackChannelId: delivery.slackChannelId,
        },
      });
      toast.success("Schedule updated");
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <Card className="block p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold tracking-tight">Scope</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Choose what these briefs summarize.
          </p>
        </div>
        <ScopePicker value={scope} onChange={setScope} />
        <div className="mt-5">
          <Label htmlFor="schedule-name" className="text-xs">
            Schedule name
          </Label>
          <Input
            id="schedule-name"
            className="mt-1.5"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameDirty(true);
            }}
            maxLength={200}
            placeholder="Auto-derived from scope"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Auto-filled from the scope — change it to anything you like.
          </p>
        </div>
      </Card>

      <Card className="block p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold tracking-tight">Cadence</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            How often the brief goes out.
          </p>
        </div>
        <CadenceFields
          cadence={cadence}
          timezone={timezone}
          onCadenceChange={setCadence}
          onTimezoneChange={setTimezone}
        />
      </Card>

      <Card className="block p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold tracking-tight">Delivery</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Where each brief is sent once it&rsquo;s ready.
          </p>
        </div>
        <DeliveryFields
          delivery={delivery}
          onChange={setDelivery}
          slackAvailable={slackAvailable}
        />
      </Card>

      {submitError ? (
        <p className="text-sm text-destructive">{submitError}</p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => navigate({ to: "/schedules" })}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting || !scope}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
