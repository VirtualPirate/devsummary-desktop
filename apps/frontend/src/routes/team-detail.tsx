import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { SectionLabel } from "@/components/devsummary/shared/section-label";
import { EmptyState } from "@/components/devsummary/shared/empty-state";
import {
  ErrorState,
  extractErrorMessage,
} from "@/components/devsummary/shared/error-state";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { TeamDialog } from "@/components/devsummary/new-team/team-dialog";
import { CollaboratorPicker } from "@/components/devsummary/new-team/collaborator-picker";
import { StatusBadge } from "@/components/devsummary/briefs/status-badge";
import { BriefDetailDialog } from "@/components/devsummary/briefs/brief-detail-dialog";
import type { BriefResponse } from "@launchstack/api-interfaces";
import { useDeleteTeam, useGetTeam } from "@/hooks/api/use-teams";
import { useGetCollaborators } from "@/hooks/api/use-collaborators";
import { useGetBriefsFirstPage } from "@/hooks/api/use-briefs";

function TeamAvatar({ name, color }: { name: string; color?: string | null }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "grid size-12 shrink-0 place-items-center rounded-2xl text-base font-bold",
        color ? "text-white" : "bg-muted text-muted-foreground",
      )}
      style={color ? { background: color } : undefined}
    >
      {initial}
    </span>
  );
}

export function TeamDetailPage() {
  const { teamId } = useParams({ strict: false });
  const navigate = useNavigate();

  const teamQuery = useGetTeam(teamId);
  const collaboratorsQuery = useGetCollaborators();
  const briefsQuery = useGetBriefsFirstPage({
    scopeType: "team",
    scopeTeamId: teamId,
    limit: 10,
  });

  const deleteMutation = useDeleteTeam();
  const [editOpen, setEditOpen] = useState(false);
  const [collabPickerOpen, setCollabPickerOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [selectedBrief, setSelectedBrief] = useState<BriefResponse | null>(
    null,
  );

  if (teamQuery.isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <SkeletonList rows={3} rowHeight={80} />
      </>
    );
  }
  if (teamQuery.isError || !teamQuery.data?.data) {
    return (
      <>
        <PageHeader title="Team" />
        <ErrorState
          message={extractErrorMessage(teamQuery.error)}
          onRetry={() => teamQuery.refetch()}
        />
      </>
    );
  }

  const team = teamQuery.data.data;
  const allCollabs = collaboratorsQuery.data?.data ?? [];
  const linked = team.collaboratorIds
    .map((id) => allCollabs.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(team.id);
      toast.success("Team deleted");
      await navigate({ to: "/teams" });
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <>
      <div className="mb-3">
        <Link
          to="/teams"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Back to teams
        </Link>
      </div>

      <header className="mb-8 border-b pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <TeamAvatar name={team.name} color={team.color} />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                {team.name}
              </h1>
              <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                {linked.length} {linked.length === 1 ? "person" : "people"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" /> Edit
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        </div>
        {team.description ? (
          <p className="mt-4 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
            {team.description}
          </p>
        ) : null}
      </header>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>Linked collaborators</SectionLabel>
          <Button size="sm" variant="outline" onClick={() => setCollabPickerOpen(true)}>
            Manage collaborators
          </Button>
        </div>
        {linked.length === 0 ? (
          <EmptyState
            icon={<User className="size-5" />}
            title="No collaborators linked"
            description="Add at least one collaborator so briefs have authors to summarize."
            action={
              <Button size="sm" onClick={() => setCollabPickerOpen(true)}>
                Add collaborators
              </Button>
            }
          />
        ) : (
          <Card className="gap-0 p-0">
            <div className="divide-y">
              {linked.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-5 py-3 text-sm"
                >
                  <Avatar className="size-8">
                    {c.avatarUrl ? <AvatarImage src={c.avatarUrl} alt={c.login} /> : null}
                    <AvatarFallback className="text-xs">
                      {c.login.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate font-medium">{c.login}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </section>

      <section>
        <SectionLabel className="mb-3">Recent briefs for this team</SectionLabel>
        {briefsQuery.isLoading ? (
          <SkeletonList rows={3} />
        ) : briefsQuery.data?.data.items.length ? (
          <Card className="gap-0 p-0">
            <div className="divide-y">
              {briefsQuery.data.data.items.map((brief) => (
                <button
                  key={brief.id}
                  type="button"
                  onClick={() => setSelectedBrief(brief)}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <div className="min-w-0 flex-1 truncate text-sm font-medium">
                    {brief.title || "Not written yet"}
                  </div>
                  <StatusBadge status={brief.status} />
                </button>
              ))}
            </div>
          </Card>
        ) : (
          <EmptyState
            title="No briefs for this team yet"
            description="Schedule a brief scoped to this team and summaries will show up here."
          />
        )}
      </section>

      <BriefDetailDialog
        brief={selectedBrief}
        open={!!selectedBrief}
        onOpenChange={(o) => !o && setSelectedBrief(null)}
      />

      <TeamDialog open={editOpen} onOpenChange={setEditOpen} team={team} />
      <CollaboratorPicker
        open={collabPickerOpen}
        onOpenChange={setCollabPickerOpen}
        team={team}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this team?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing briefs for this team will lose their scope label. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteMutation.isPending}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
