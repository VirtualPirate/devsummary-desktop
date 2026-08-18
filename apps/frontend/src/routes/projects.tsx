import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { FolderKanban, Plus } from "lucide-react";
import type { Project } from "@launchstack/api-interfaces";
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
import { ProjectDialog } from "@/components/devsummary/new-project/project-dialog";
import { useGetProjects } from "@/hooks/api/use-projects";

function ProjectAvatar({ name, color }: { name: string; color?: string | null }) {
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

export function ProjectsPage() {
  const projectsQuery = useGetProjects();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Group repositories so a brief covers exactly the right scope."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> New project
          </Button>
        }
      />

      {projectsQuery.isLoading ? (
        <SkeletonGrid cards={6} cardHeight={120} />
      ) : projectsQuery.isError ? (
        <ErrorState
          message={extractErrorMessage(projectsQuery.error)}
          onRetry={() => projectsQuery.refetch()}
        />
      ) : projectsQuery.data?.data.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="size-6" />}
          title="No projects yet"
          description="Create a project to group repositories, then briefs can cover just that work."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" /> New project
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(projectsQuery.data?.data ?? []).map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      <ProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const repoCount = project.repositoryIds.length;
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="group block rounded-2xl transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Card className="h-full gap-3 p-5 transition-shadow group-hover:shadow-e2">
        <div className="flex items-start gap-3">
          <ProjectAvatar name={project.name} color={project.color} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
              {project.name}
            </h3>
            <p className="text-xs tabular-nums text-muted-foreground">
              {repoCount} {repoCount === 1 ? "repository" : "repositories"}
            </p>
          </div>
        </div>
        {project.description ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {project.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground/60">No description yet</p>
        )}
      </Card>
    </Link>
  );
}
