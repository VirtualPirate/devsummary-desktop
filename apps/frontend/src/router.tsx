import {
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type SearchSchemaInput,
} from "@tanstack/react-router";

import App from "@/App";
import { isActivityRange, type ActivityRange } from "@/lib/activity-window";
import {
  briefFilterPrefs,
  filtersToRestore,
  homeFilterPrefs,
  type FilterKey,
  type SavedFilters,
} from "@/stores/filter-prefs-store";
import { CreateOrganizationPage } from "@/routes/create-organization";
import { BriefCommitsPage } from "@/routes/brief-commits";
import { BriefDetailPage } from "@/routes/brief-detail";
import { BriefsPage } from "@/routes/briefs";
import { ProjectDetailPage } from "@/routes/project-detail";
import { ProjectsPage } from "@/routes/projects";
import { ScheduleDetailPage } from "@/routes/schedule-detail";
import { ScheduleNewPage } from "@/routes/schedule-new";
import { SchedulesPage } from "@/routes/schedules";
import { TeamDetailPage } from "@/routes/team-detail";
import { TeamsPage } from "@/routes/teams";
import { HomePage } from "@/routes/home";
import { IntegrationsGithubPage } from "@/routes/integrations-github";
import { IntegrationsGithubSetupPage } from "@/routes/integrations-github-setup";
import { IntegrationsSlackPage } from "@/routes/integrations-slack";
import { OrganizationSettingsPage } from "@/routes/organization-settings";
import { SettingsPage } from "@/routes/settings";
import type { BriefScopeType } from "@launchstack/api-interfaces";

type IntegrationsGithubSearch = {
  connected?: string;
  error?: string;
};

const integrationsGithubSearchSchema = (
  search: Record<string, unknown>,
): IntegrationsGithubSearch => ({
  connected:
    typeof search.connected === "string" ? search.connected : undefined,
  error: typeof search.error === "string" ? search.error : undefined,
});

type FilterType = "all" | BriefScopeType;

const FILTER_TYPES: FilterType[] = [
  "all",
  "project",
  "team",
  "collaborator",
  "repository",
];

const isFilterType = (v: unknown): v is FilterType =>
  FILTER_TYPES.includes(v as FilterType);

type BriefsSearch = {
  filterType: FilterType;
  from: string;
  to: string;
  scopeId: string;
  excludeNoActivity: boolean;
  page: number;
};

const briefsSearchSchema = (
  search: Record<string, unknown>,
): BriefsSearch => ({
  filterType: isFilterType(search.filterType) ? search.filterType : "all",
  from: typeof search.from === "string" ? search.from : "",
  to: typeof search.to === "string" ? search.to : "",
  scopeId: typeof search.scopeId === "string" ? search.scopeId : "",
  excludeNoActivity: search.excludeNoActivity === true,
  page:
    typeof search.page === "number" && search.page >= 0
      ? Math.floor(search.page)
      : 0,
});

export type HomeSearch = {
  range: ActivityRange;
  repo: string;
  collaborator: string;
};

// SearchSchemaInput keeps `search` optional for navigate({ to: "/" })
// callers while useSearch still returns the fully-defaulted HomeSearch.
const homeSearchSchema = (
  search: Record<string, unknown> & SearchSchemaInput,
): HomeSearch => ({
  range: isActivityRange(search.range) ? search.range : "30d",
  repo: typeof search.repo === "string" ? search.repo : "",
  collaborator:
    typeof search.collaborator === "string" ? search.collaborator : "",
});

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  // There is no address bar in the shell, so an unmatched path is either a stale
  // auth URL (/sign-in, /accept-invite, …) left in a bookmark or a bad Link —
  // both of which are better answered by the dashboard than by a dead end.
  notFoundComponent: () => <Navigate to="/" replace />,
});

// Pathless layout: no session, no guard. The shell renders directly.
const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "protected",
  component: App,
});

// Entering a filterable page with a bare URL (sidebar link, fresh tab) re-applies
// the filters the user last chose. Anything explicit in the URL wins, so links,
// bookmarks and the back button are untouched.
const restoreSearch = (
  key: FilterKey,
  current: SavedFilters,
  to: "/" | "/briefs",
) => {
  const saved = filtersToRestore(key, current);
  if (!saved) return;
  // The saved set is partial by design (only the values that narrow something);
  // validateSearch fills the rest back in on arrival.
  throw redirect({ to, search: saved, replace: true } as never);
};

const homeRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/",
  validateSearch: homeSearchSchema,
  beforeLoad: ({ search }) =>
    restoreSearch("home", homeFilterPrefs(search), "/"),
  component: HomePage,
});

const projectsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects",
  component: ProjectsPage,
});

const projectDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/projects/$projectId",
  component: ProjectDetailPage,
});

const teamsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/teams",
  component: TeamsPage,
});

const teamDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/teams/$teamId",
  component: TeamDetailPage,
});

const briefsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/briefs",
  validateSearch: briefsSearchSchema,
  // Page number is deliberately not restored: the list is cursor-paginated, so
  // page 3 means nothing until pages 1-2 have been fetched.
  beforeLoad: ({ search }) =>
    restoreSearch("briefs", briefFilterPrefs(search), "/briefs"),
  component: BriefsPage,
});

const briefDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/briefs/$briefId",
  component: BriefDetailPage,
});

const briefCommitsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/briefs/$briefId/commits",
  component: BriefCommitsPage,
});

const schedulesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/schedules",
  component: SchedulesPage,
});

const scheduleNewRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/schedules/new",
  component: ScheduleNewPage,
});

const scheduleDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/schedules/$scheduleId",
  component: ScheduleDetailPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings",
  component: SettingsPage,
});

const createOrganizationRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/organizations/new",
  component: CreateOrganizationPage,
});

const organizationSettingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/organization",
  component: OrganizationSettingsPage,
});

const integrationsGithubRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/integrations/github",
  validateSearch: integrationsGithubSearchSchema,
  component: IntegrationsGithubPage,
});

const integrationsGithubSetupRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/integrations/github/setup",
  // Connecting a token redirects here with ?connected=1 — the same flag the
  // integrations page used to receive from the install callback.
  validateSearch: integrationsGithubSearchSchema,
  component: IntegrationsGithubSetupPage,
});

const integrationsSlackRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/integrations/slack",
  validateSearch: integrationsGithubSearchSchema,
  component: IntegrationsSlackPage,
});

const routeTree = rootRoute.addChildren([
  protectedRoute.addChildren([
    homeRoute,
    projectsRoute,
    projectDetailRoute,
    teamsRoute,
    teamDetailRoute,
    briefsRoute,
    briefDetailRoute,
    briefCommitsRoute,
    schedulesRoute,
    scheduleNewRoute,
    scheduleDetailRoute,
    settingsRoute,
    createOrganizationRoute,
    organizationSettingsRoute,
    integrationsGithubRoute,
    integrationsGithubSetupRoute,
    integrationsSlackRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
