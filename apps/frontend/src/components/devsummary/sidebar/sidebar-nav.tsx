import { useLocation } from "@tanstack/react-router";
import { Bot, CalendarClock, ChevronDown, ChevronRight, FileText, Home, Plug, Settings as SettingsIcon } from "lucide-react";
import { useGetProjects } from "@/hooks/api/use-projects";
import { useGetTeams } from "@/hooks/api/use-teams";
import { useGetBriefSchedules } from "@/hooks/api/use-brief-schedules";
import { useGetBriefsFirstPage } from "@/hooks/api/use-briefs";
import { useSidebarPrefs, type SidebarScope } from "@/stores/sidebar-prefs-store";
import { EntityDot } from "@/components/devsummary/shared/entity-dot";
import { CloudPromo } from "./cloud-promo";
import { PinToggle } from "./pin-toggle";
import { SidebarItem } from "./sidebar-item";
import { SidebarSection } from "./sidebar-section";

interface PinnableRecord {
  id: string;
  name: string;
  color: string;
}

function detectActiveId(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (!rest) return null;
  return rest.split("/")[0] || null;
}

function PinnableSection({
  scope,
  label,
  records,
  detailPathFor,
  indexPath,
  isLoading,
}: {
  scope: SidebarScope;
  label: string;
  records: PinnableRecord[];
  detailPathFor: (id: string) => string;
  indexPath: string;
  isLoading: boolean;
}) {
  const location = useLocation();
  const pinnedIds = useSidebarPrefs((s) => s.pinned[scope]);
  const collapsed = useSidebarPrefs((s) => s.collapsed[scope]);
  const toggleCollapse = useSidebarPrefs((s) => s.toggleCollapse);

  const byId = new Map(records.map((r) => [r.id, r]));
  const pinnedRecords = pinnedIds
    .map((id) => byId.get(id))
    .filter((r): r is PinnableRecord => Boolean(r));

  const activeId = detectActiveId(location.pathname, `${indexPath}/`);
  const activeRecord = activeId ? byId.get(activeId) ?? null : null;
  const activeIsPinned = activeRecord ? pinnedIds.includes(activeRecord.id) : false;
  const showActive = activeRecord && !activeIsPinned;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => toggleCollapse(scope)}
        className="flex w-full items-center gap-1 px-2 pb-1 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground"
      >
        {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        <span>{label}</span>
        {collapsed ? <span className="ml-1 normal-case tracking-normal">({records.length})</span> : null}
      </button>
      {collapsed ? null : (
        <div className="flex flex-col gap-0.5">
          {pinnedRecords.map((r) => (
            <SidebarItem
              key={r.id}
              to={detailPathFor(r.id)}
              icon={<EntityDot color={r.color} />}
              trailing={<PinToggle scope={scope} id={r.id} />}
            >
              {r.name}
            </SidebarItem>
          ))}
          {showActive && activeRecord ? (
            <SidebarItem
              key={`active-${activeRecord.id}`}
              to={detailPathFor(activeRecord.id)}
              icon={<EntityDot color={activeRecord.color} />}
              trailing={<PinToggle scope={scope} id={activeRecord.id} />}
            >
              {activeRecord.name}
            </SidebarItem>
          ) : null}
          <SidebarItem to={indexPath}>
            <span className="text-muted-foreground">
              {isLoading ? "Loading…" : `See all ${records.length} →`}
            </span>
          </SidebarItem>
        </div>
      )}
    </div>
  );
}

export function SidebarNav() {
  const projectsQuery = useGetProjects();
  const teamsQuery = useGetTeams();
  const briefsQuery = useGetBriefsFirstPage({ limit: 1 });
  const schedulesQuery = useGetBriefSchedules();

  const projects = (projectsQuery.data?.data ?? []).map<PinnableRecord>((p) => ({
    id: p.id,
    name: p.name,
    color: p.color ?? "var(--muted-foreground)",
  }));
  const teams = (teamsQuery.data?.data ?? []).map<PinnableRecord>((t) => ({
    id: t.id,
    name: t.name,
    color: t.color ?? "var(--muted-foreground)",
  }));

  const briefBadge = briefsQuery.data?.data.items.length ? "•" : undefined;
  const activeSchedules =
    schedulesQuery.data?.data.filter((s) => !s.paused).length ?? 0;

  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-3 text-sm">
      <SidebarSection>
        <SidebarItem to="/" icon={<Home className="size-3.5" />} exact>Home</SidebarItem>
        <SidebarItem to="/agents" icon={<Bot className="size-3.5" />}>
          Agent
        </SidebarItem>
        <SidebarItem to="/briefs" icon={<FileText className="size-3.5" />}>
          Briefs {briefBadge ? <span className="ml-1 text-muted-foreground">{briefBadge}</span> : null}
        </SidebarItem>
        <SidebarItem to="/schedules" icon={<CalendarClock className="size-3.5" />} count={activeSchedules}>
          Schedules
        </SidebarItem>
      </SidebarSection>

      <PinnableSection
        scope="projects"
        label="Projects"
        records={projects}
        detailPathFor={(id) => `/projects/${id}`}
        indexPath="/projects"
        isLoading={projectsQuery.isLoading}
      />
      <PinnableSection
        scope="teams"
        label="Teams"
        records={teams}
        detailPathFor={(id) => `/teams/${id}`}
        indexPath="/teams"
        isLoading={teamsQuery.isLoading}
      />

      <SidebarSection label="Sources">
        <SidebarItem to="/integrations/github" icon={<Plug className="size-3.5" />}>Integrations</SidebarItem>
      </SidebarSection>

      <SidebarSection label="Workspace">
        <SidebarItem to="/settings" icon={<SettingsIcon className="size-3.5" />}>Settings</SidebarItem>
      </SidebarSection>

      <CloudPromo />
    </nav>
  );
}
