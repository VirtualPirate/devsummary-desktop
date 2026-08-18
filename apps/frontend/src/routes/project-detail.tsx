import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, GitBranch, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { ProjectDialog } from "@/components/devsummary/new-project/project-dialog";
import { RepositoryPicker } from "@/components/devsummary/new-project/repository-picker";
import { StatusBadge } from "@/components/devsummary/briefs/status-badge";
import { BriefDetailDialog } from "@/components/devsummary/briefs/brief-detail-dialog";
import type { BriefResponse } from "@launchstack/api-interfaces";
import {
  useDeleteProject,
  useGetProject,
} from "@/hooks/api/use-projects";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";
import { useGetBriefsFirstPage } from "@/hooks/api/use-briefs";

function ProjectAvatar({ name, color }: { name: string; color?: string | null }) {
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

export function ProjectDetailPage() {
  const { projectId } = useParams({ strict: false });
  const navigate = useNavigate();

  const projectQuery = useGetProject(projectId);
  const installationsQuery = useGithubInstallations();
  const briefsQuery = useGetBriefsFirstPage({
    scopeType: "project",
    scopeProjectId: projectId,
    limit: 10,
  });

  const deleteMutation = useDeleteProject();
  const [editOpen, setEditOpen] = useState(false);
  const [repoPickerOpen, setRepoPickerOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [selectedBrief, setSelectedBrief] = useState<BriefResponse | null>(
    null,
  );

  if (projectQuery.isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <SkeletonList rows={3} rowHeight={80} />
      </>
    );
  }
  if (projectQuery.isError || !projectQuery.data?.data) {
    return (
      <>
        <PageHeader title="Project" />
        <ErrorState
          message={extractErrorMessage(projectQuery.error)}
          onRetry={() => projectQuery.refetch()}
        />
      </>
    );
  }

  const project = projectQuery.data.data;

  const allRepos = (installationsQuery.data?.data ?? []).flatMap((i) => i.repositories);
  const linkedRepos = project.repositoryIds
    .map((id) => {
      const repo = allRepos.find((r) => r.id === id);
      return repo
        ? { id: repo.id, name: repo.fullName ?? repo.name }
        : { id, name: "(unavailable)" };
    });

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(project.id);
      toast.success("Project deleted");
      await navigate({ to: "/projects" });
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <>
      <div className="mb-3">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Back to projects
        </Link>
      </div>

      <header className="mb-8 border-b pb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <ProjectAvatar name={project.name} color={project.color} />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                {project.name}
              </h1>
              <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                {linkedRepos.length}{" "}
                {linkedRepos.length === 1 ? "repository" : "repositories"}
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
        {project.description ? (
          <p className="mt-4 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
            {project.description}
          </p>
        ) : null}
      </header>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel>Linked repositories</SectionLabel>
          <Button size="sm" variant="outline" onClick={() => setRepoPickerOpen(true)}>
            Manage repositories
          </Button>
        </div>
        {linkedRepos.length === 0 ? (
          <EmptyState
            icon={<GitBranch className="size-5" />}
            title="No repositories linked"
            description="Add at least one repository so briefs have commit activity to summarize."
            action={
              <Button size="sm" onClick={() => setRepoPickerOpen(true)}>
                Add repositories
              </Button>
            }
          />
        ) : (
          <Card className="gap-0 p-0">
            <div className="divide-y">
              {linkedRepos.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 px-5 py-3 text-sm"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <GitBranch className="size-3.5" />
                  </span>
                  <span className="truncate font-medium">{r.name}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </section>

      <section>
        <SectionLabel className="mb-3">Recent briefs for this project</SectionLabel>
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
            title="No briefs for this project yet"
            description="Schedule a brief scoped to this project and summaries will show up here."
          />
        )}
      </section>

      <BriefDetailDialog
        brief={selectedBrief}
        open={!!selectedBrief}
        onOpenChange={(o) => !o && setSelectedBrief(null)}
      />

      <ProjectDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        project={project}
      />
      <RepositoryPicker
        open={repoPickerOpen}
        onOpenChange={setRepoPickerOpen}
        project={project}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing briefs for this project will keep rendering but lose their scope label.
              This action can't be undone.
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
