import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import type { ScopeInput } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { useGetProjects } from "@/hooks/api/use-projects";
import { useGetTeams } from "@/hooks/api/use-teams";
import { useGetCollaborators } from "@/hooks/api/use-collaborators";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";

export type ScopeType = ScopeInput["type"];

const SCOPE_TYPES: { type: ScopeType; label: string }[] = [
  { type: "project", label: "Project" },
  { type: "team", label: "Team" },
  { type: "collaborator", label: "Person" },
  { type: "repository", label: "Repository" },
];

function AvatarSquare({ color, initial }: { color?: string | null; initial: string }) {
  if (!color) {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[0.65rem] font-bold text-muted-foreground">
        {initial}
      </span>
    );
  }
  return (
    <span
      className="grid size-6 shrink-0 place-items-center rounded-md text-[0.65rem] font-bold text-white"
      style={{ background: color }}
    >
      {initial}
    </span>
  );
}

function OptionRow({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition",
        selected ? "bg-brand/12 text-brand" : "hover:bg-muted/60",
        disabled && "cursor-not-allowed opacity-55 hover:bg-transparent",
      )}
    >
      {children}
      {selected ? <Check className="ml-auto size-4 shrink-0" /> : null}
    </button>
  );
}

function EntityHint({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">{children}</p>
  );
}

export function ScopePicker({
  value,
  onChange,
}: {
  value: ScopeInput | null;
  onChange: (next: ScopeInput | null) => void;
}) {
  const projectsQuery = useGetProjects();
  const teamsQuery = useGetTeams();
  const collaboratorsQuery = useGetCollaborators();
  const installationsQuery = useGithubInstallations();

  const activeType: ScopeType = value?.type ?? "project";

  const handleTypeChange = (next: ScopeType) => {
    if (next === "project") {
      const firstId = projectsQuery.data?.data[0]?.id;
      onChange(firstId ? { type: "project", projectId: firstId } : null);
    } else if (next === "team") {
      const firstId = teamsQuery.data?.data[0]?.id;
      onChange(firstId ? { type: "team", teamId: firstId } : null);
    } else if (next === "collaborator") {
      const firstId = collaboratorsQuery.data?.data[0]?.id;
      onChange(firstId ? { type: "collaborator", collaboratorId: firstId } : null);
    } else {
      // First repository that actually reads something — preselecting an
      // unconfigured one would hand the form a scope the API rejects.
      const firstId = installationsQuery.data?.data
        .flatMap((i) => i.repositories)
        .find((r) => r.branch !== null)?.id;
      onChange(firstId ? { type: "repository", repositoryId: firstId } : null);
    }
  };

  const projects = projectsQuery.data?.data ?? [];
  const teams = teamsQuery.data?.data ?? [];
  const collaborators = collaboratorsQuery.data?.data ?? [];
  const repositories = (installationsQuery.data?.data ?? []).flatMap((i) => i.repositories);

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">What should it cover?</Label>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-2xl border bg-card p-1 sm:grid-cols-4 sm:rounded-full">
          {SCOPE_TYPES.map(({ type, label }) => {
            const active = activeType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => handleTypeChange(type)}
                aria-pressed={active}
                className={cn(
                  "rounded-xl px-3 py-1.5 text-xs font-medium transition sm:rounded-full",
                  active
                    ? "bg-brand/12 text-brand"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label className="text-xs">Choose one</Label>
        <div className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto rounded-xl border bg-background/40 p-1.5">
          {activeType === "project" ? (
            projects.length === 0 ? (
              <EntityHint>No projects yet — create one first.</EntityHint>
            ) : (
              projects.map((p) => (
                <OptionRow
                  key={p.id}
                  selected={value?.type === "project" && value.projectId === p.id}
                  onClick={() => onChange({ type: "project", projectId: p.id })}
                >
                  <AvatarSquare color={p.color} initial={p.name.charAt(0).toUpperCase()} />
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                </OptionRow>
              ))
            )
          ) : activeType === "team" ? (
            teams.length === 0 ? (
              <EntityHint>No teams yet — create one first.</EntityHint>
            ) : (
              teams.map((t) => (
                <OptionRow
                  key={t.id}
                  selected={value?.type === "team" && value.teamId === t.id}
                  onClick={() => onChange({ type: "team", teamId: t.id })}
                >
                  <AvatarSquare color={t.color} initial={t.name.charAt(0).toUpperCase()} />
                  <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                </OptionRow>
              ))
            )
          ) : activeType === "collaborator" ? (
            collaborators.length === 0 ? (
              <EntityHint>No collaborators synced yet.</EntityHint>
            ) : (
              collaborators.map((c) => (
                <OptionRow
                  key={c.id}
                  selected={value?.type === "collaborator" && value.collaboratorId === c.id}
                  onClick={() => onChange({ type: "collaborator", collaboratorId: c.id })}
                >
                  <Avatar className="size-6 shrink-0">
                    {c.avatarUrl ? <AvatarImage src={c.avatarUrl} alt={c.login} /> : null}
                    <AvatarFallback className="text-[0.6rem]">
                      {c.login.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate font-medium">{c.login}</span>
                </OptionRow>
              ))
            )
          ) : repositories.length === 0 ? (
            <EntityHint>No repositories connected yet.</EntityHint>
          ) : (
            repositories.map((r) => (
              /* A repository with no branch chosen reads no commits, so a brief
                 scoped to it could only ever be empty — the API refuses it too.
                 Shown rather than hidden, since the fix is one link away. */
              <OptionRow
                key={r.id}
                selected={value?.type === "repository" && value.repositoryId === r.id}
                disabled={r.branch === null}
                onClick={() => onChange({ type: "repository", repositoryId: r.id })}
              >
                <AvatarSquare
                  initial={(r.fullName.split("/").pop() ?? r.fullName).charAt(0).toUpperCase()}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{r.fullName}</span>
                <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                  {r.branch ? (
                    <span className="font-mono">{r.branch}</span>
                  ) : (
                    "No branch chosen"
                  )}
                </span>
              </OptionRow>
            ))
          )}
        </div>
        {activeType === "repository" &&
        repositories.some((r) => r.branch === null) ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Greyed-out repositories have no branch yet.{" "}
            <Link
              to="/integrations/github/setup"
              className="font-medium text-brand underline-offset-2 hover:underline"
            >
              Choose a branch
            </Link>{" "}
            to make them reportable.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { deriveScopeName } from "@/lib/scope-name";
