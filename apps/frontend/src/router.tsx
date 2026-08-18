import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type SearchSchemaInput,
} from "@tanstack/react-router";

import App from "@/App";
import { AuthAPI } from "@/api/auth.api";
import { clearSignedOutUserState } from "@/hooks/api/use-auth";
import { queryClient } from "@/lib/query-client";
import { normalizeRedirectPath } from "@/lib/auth-redirect";
import { isActivityRange, type ActivityRange } from "@/lib/activity-window";
import {
  briefFilterPrefs,
  filtersToRestore,
  homeFilterPrefs,
  type FilterKey,
  type SavedFilters,
} from "@/stores/filter-prefs-store";
import { AcceptInvitePage } from "@/routes/accept-invite";
import { AuthErrorPage } from "@/routes/auth-error";
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
import { ForgotPasswordPage } from "@/routes/forgot-password";
import { GoogleSignInPage } from "@/routes/google-sign-in";
import { GoogleSignUpPage } from "@/routes/google-sign-up";
import { HomePage } from "@/routes/home";
import { IntegrationsGithubPage } from "@/routes/integrations-github";
import { IntegrationsGithubSetupPage } from "@/routes/integrations-github-setup";
import { IntegrationsSlackPage } from "@/routes/integrations-slack";
import { OrganizationMembersPage } from "@/routes/organization-members";
import { OrganizationSettingsPage } from "@/routes/organization-settings";
import { PendingInvitesPage } from "@/routes/pending-invites";
import { ResetPasswordPage } from "@/routes/reset-password";
import { SettingsPage } from "@/routes/settings";
import { SignInPage } from "@/routes/sign-in";
import { SignUpPage } from "@/routes/sign-up";
import { VerifyEmailPage } from "@/routes/verify-email";
import type { BriefScopeType } from "@launchstack/api-interfaces";

type AuthSearch = {
  redirect?: string;
  email?: string;
};

type SignInSearch = AuthSearch & { reset?: "success" };

type VerifyEmailSearch = {
  redirect?: string;
  email?: string;
};

type AuthErrorSearch = {
  redirect?: string;
  mode?: "sign-in" | "sign-up";
  message?: string;
  error?: string;
  error_description?: string;
};

type ResetPasswordSearch = { email?: string };

type AcceptInviteSearch = {
  token?: string;
};

type IntegrationsGithubSearch = {
  connected?: string;
  error?: string;
};

const authSearchSchema = (search: Record<string, unknown>): AuthSearch => ({
  redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  email: typeof search.email === "string" ? search.email : undefined,
});

const signInSearchSchema = (
  search: Record<string, unknown>,
): SignInSearch => ({
  redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  email: typeof search.email === "string" ? search.email : undefined,
  reset: search.reset === "success" ? "success" : undefined,
});

const resetPasswordSearchSchema = (
  search: Record<string, unknown>,
): ResetPasswordSearch => ({
  email: typeof search.email === "string" ? search.email : undefined,
});

const verifyEmailSearchSchema = (
  search: Record<string, unknown>,
): VerifyEmailSearch => ({
  redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  email: typeof search.email === "string" ? search.email : undefined,
});

const authErrorSearchSchema = (
  search: Record<string, unknown>,
): AuthErrorSearch => ({
  redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  mode:
    search.mode === "sign-in" || search.mode === "sign-up"
      ? search.mode
      : undefined,
  message: typeof search.message === "string" ? search.message : undefined,
  error: typeof search.error === "string" ? search.error : undefined,
  error_description:
    typeof search.error_description === "string"
      ? search.error_description
      : undefined,
});

const acceptInviteSearchSchema = (
  search: Record<string, unknown>,
): AcceptInviteSearch => ({
  token: typeof search.token === "string" ? search.token : undefined,
});

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
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
      Page not found.
    </div>
  ),
});

async function redirectAuthenticatedUser(search: AuthSearch) {
  const sessionResult = await AuthAPI.getSession();
  if (!sessionResult.data?.session) {
    return;
  }

  if (sessionResult.data.user.emailVerified !== true) {
    throw redirect({
      to: "/verify-email",
      search: {
        email: sessionResult.data.user.email,
        redirect: normalizeRedirectPath(search.redirect),
      },
    });
  }

  throw redirect({ to: normalizeRedirectPath(search.redirect) });
}

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: signInSearchSchema,
  beforeLoad: async ({ search }) => {
    await redirectAuthenticatedUser(search);
  },
  component: SignInPage,
});

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-up",
  validateSearch: authSearchSchema,
  beforeLoad: async ({ search }) => {
    await redirectAuthenticatedUser(search);
  },
  component: SignUpPage,
});

const googleSignInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/google-sign-in",
  validateSearch: authSearchSchema,
  beforeLoad: async ({ search }) => {
    await redirectAuthenticatedUser(search);
  },
  component: GoogleSignInPage,
});

const googleSignUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/google-sign-up",
  validateSearch: authSearchSchema,
  beforeLoad: async ({ search }) => {
    await redirectAuthenticatedUser(search);
  },
  component: GoogleSignUpPage,
});

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/verify-email",
  validateSearch: verifyEmailSearchSchema,
  beforeLoad: async ({ search }) => {
    const sessionResult = await AuthAPI.getSession();
    if (sessionResult.data?.session && sessionResult.data.user.emailVerified === true) {
      throw redirect({ to: normalizeRedirectPath(search.redirect) });
    }
  },
  component: VerifyEmailPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  validateSearch: authSearchSchema,
  beforeLoad: async ({ search }) => {
    await redirectAuthenticatedUser(search);
  },
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: resetPasswordSearchSchema,
  component: ResetPasswordPage,
});

const authErrorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth/error",
  validateSearch: authErrorSearchSchema,
  component: AuthErrorPage,
});

const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accept-invite",
  validateSearch: acceptInviteSearchSchema,
  component: AcceptInvitePage,
});

const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "protected",
  beforeLoad: async ({ location }) => {
    const sessionResult = await AuthAPI.getSession();
    if (!sessionResult.data?.session) {
      // Sessions also end without anyone clicking Sign out (expiry, revocation).
      // Drop the previous user's cached data and active org here too, or the next
      // user to sign in on this machine inherits their org header and org list.
      clearSignedOutUserState(queryClient);
      throw redirect({
        to: "/sign-in",
        search: {
          redirect: location.pathname,
        },
      });
    }

    if (sessionResult.data.user.emailVerified !== true) {
      throw redirect({
        to: "/verify-email",
        search: {
          email: sessionResult.data.user.email,
          redirect: location.pathname,
        },
      });
    }
  },
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

const pendingInvitesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/invites",
  component: PendingInvitesPage,
});

const organizationSettingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/organization",
  component: OrganizationSettingsPage,
});

const organizationMembersRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings/organization/members",
  component: OrganizationMembersPage,
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
  // The install callback lands here with ?connected=1 — the same flag the
  // integrations page used to receive, since success now redirects to setup.
  validateSearch: integrationsGithubSearchSchema,
  component: IntegrationsGithubSetupPage,
});

const integrationsSlackRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/integrations/slack",
  // The Slack OAuth callback lands here with ?connected=1 or ?error=<code> —
  // the same shape GitHub's callback uses.
  validateSearch: integrationsGithubSearchSchema,
  component: IntegrationsSlackPage,
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  signUpRoute,
  googleSignInRoute,
  googleSignUpRoute,
  verifyEmailRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  authErrorRoute,
  acceptInviteRoute,
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
    pendingInvitesRoute,
    organizationSettingsRoute,
    organizationMembersRoute,
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
