import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Users } from "lucide-react";
import type { Team } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { EmptyState } from "@/components/devsummary/shared/empty-state";
import {
  ErrorState,
  extractErrorMessage,
} from "@/components/devsummary/shared/error-state";
import { SkeletonGrid } from "@/components/devsummary/shared/skeleton-list";
import { TeamDialog } from "@/components/devsummary/new-team/team-dialog";
import { useGetTeams } from "@/hooks/api/use-teams";

function TeamAvatar({ name, color }: { name: string; color?: string | null }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold",
        color ? "text-white" : "bg-muted text-muted-foreground",
      )}
      style={color ? { background: color } : undefined}
    >
      {initial}
    </span>
  );
}

export function TeamsPage() {
  const teamsQuery = useGetTeams();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Teams"
        description="Group collaborators so a brief can focus on their work."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> New team
          </Button>
        }
      />

      {teamsQuery.isLoading ? (
        <SkeletonGrid cards={6} cardHeight={120} />
      ) : teamsQuery.isError ? (
        <ErrorState
          message={extractErrorMessage(teamsQuery.error)}
          onRetry={() => teamsQuery.refetch()}
        />
      ) : teamsQuery.data?.data.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title="No teams yet"
          description="Create a team to group collaborators, then briefs can focus on their work."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" /> New team
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(teamsQuery.data?.data ?? []).map((team) => (
            <TeamCard key={team.id} team={team} />
          ))}
        </div>
      )}

      <TeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function TeamCard({ team }: { team: Team }) {
  const memberCount = team.collaboratorIds.length;
  return (
    <Link
      to="/teams/$teamId"
      params={{ teamId: team.id }}
      className="group block rounded-2xl transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Card className="h-full gap-3 p-5 transition-shadow group-hover:shadow-e2">
        <div className="flex items-start gap-3">
          <TeamAvatar name={team.name} color={team.color} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
              {team.name}
            </h3>
            <p className="text-xs tabular-nums text-muted-foreground">
              {memberCount} {memberCount === 1 ? "person" : "people"}
            </p>
          </div>
        </div>
        {team.description ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {team.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground/60">No description yet</p>
        )}
      </Card>
    </Link>
  );
}
