import type { ScopeInput } from "@launchstack/api-interfaces";

export function deriveScopeName(
  value: ScopeInput | null,
  projects: Array<{ id: string; name: string }>,
  teams: Array<{ id: string; name: string }>,
  collaborators: Array<{ id: string; login: string }>,
  repositories: Array<{ id: string; fullName: string }>,
  cadenceType: "daily" | "weekly" | "monthly",
): string {
  if (!value) return "New brief";
  const cadenceWord =
    cadenceType === "daily" ? "Daily" : cadenceType === "weekly" ? "Weekly" : "Monthly";
  if (value.type === "project") {
    const p = projects.find((x) => x.id === value.projectId);
    return p ? `${p.name} ${cadenceWord.toLowerCase()} brief` : `${cadenceWord} brief`;
  }
  if (value.type === "team") {
    const t = teams.find((x) => x.id === value.teamId);
    return t ? `${t.name} ${cadenceWord.toLowerCase()} brief` : `${cadenceWord} brief`;
  }
  if (value.type === "collaborator") {
    const c = collaborators.find((x) => x.id === value.collaboratorId);
    return c ? `${c.login} ${cadenceWord.toLowerCase()} brief` : `${cadenceWord} brief`;
  }
  const r = repositories.find((x) => x.id === value.repositoryId);
  return r ? `${r.fullName} ${cadenceWord.toLowerCase()} brief` : `${cadenceWord} brief`;
}
