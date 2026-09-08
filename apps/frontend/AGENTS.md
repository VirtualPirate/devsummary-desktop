# Frontend — DevSummary (React + Vite + Tailwind v4)

The frontend app for DevSummary: an organization-scoped dashboard for generating AI briefs from GitHub activity (projects, teams, collaborators, repositories, brief schedules, GitHub integrations).

## Stack

React 19, Vite 7, TypeScript 5.9 (strict), TanStack Router v1 (code-based), TanStack Query v5, Zustand v5 (persisted stores), Tailwind CSS v4, shadcn/ui (Radix Nova style), Axios, Zod v4, sonner (toasts), lucide-react (icons), recharts.

This is the renderer of an Electron desktop app. There is no sign-in: the backend seeds one local user and one default workspace, and the app opens on the dashboard.

## Commands

```bash
pnpm dev          # Vite dev server on :5173 (or `pnpm dev:frontend` from repo root)
pnpm build        # tsc -b && vite build
pnpm lint         # eslint .
pnpm preview      # Preview production build
pnpm dlx shadcn@latest add <component>   # Add a shadcn/ui component
```

There is no frontend test setup — tests live in the backend only.

## Directory Layout

```
src/
  api/                       # One API module per backend domain + axios-client.ts
  components/
    devsummary/              # App shell, sidebar, topbar + feature components
      briefs/ new-project/ new-team/ schedules/ shared/
    integrations/            # GitHub + Slack credential forms and status cards
    organization/            # Workspace switcher, role badge
    theme/                   # ThemeProvider + toggles
    ui/                      # shadcn/ui primitives
  env/config-env.ts          # Async API bootstrap (port + desktop token)
  hooks/
    api/use-<domain>.ts      # React Query hooks + query-key factory per domain
    use-bootstrap-active-organization.ts
  lib/                       # extract-error, utils (cn), small formatters
  routes/                    # One page component per route (<name>.tsx exports <Name>Page)
  stores/                    # Zustand stores (active workspace, sidebar prefs)
  router.tsx                 # ALL route definitions (code-based TanStack Router)
  App.tsx                    # Renders AppShell (the app layout)
  main.tsx                   # ThemeProvider > TooltipProvider > QueryClientProvider > RouterProvider + Toaster
```

`@` maps to `src/` (vite.config.ts + tsconfig).

## Routing

Routes are defined **code-based** in `src/router.tsx` (no file-based routing plugin). One pathless layout route under the root:

- **`protectedRoute`** (pathless, `id: "protected"`) — wraps every page. It has **no `beforeLoad` guard**: there is no session to check. Its component is `App` → `AppShell` (Topbar + SidebarNav + `<Outlet/>`).
- The root route's `notFoundComponent` redirects to `/`. There is no address bar in the shell, so an unmatched path is a stale auth URL or a bad `Link`, and the dashboard is a better answer than a dead end.

To add a page:
1. Create `src/routes/<kebab-name>.tsx` exporting a named `<PascalName>Page` component.
2. In `router.tsx`: `createRoute({ getParentRoute: () => protectedRoute, path: "...", component: ... })` and add it to the `routeTree` children.

Search params are validated with hand-written `validateSearch` narrowing functions (plain `typeof` checks returning a typed object — not Zod).

## Workspace Scoping (cross-cutting)

Organizations survive the desktop port as local **workspaces** — the `organizationId` column, the header and the switcher are all unchanged; only sign-in is gone. Almost all data is scoped to the active workspace. The pieces:

- `useActiveOrganizationStore` (Zustand, persisted to localStorage) holds `activeOrganizationId`.
- The axios request interceptor (`src/api/axios-client.ts`) injects it as the `X-Organization-Id` header on **every** request; backend URLs use `/api/organizations/current/...`.
- `useBootstrapActiveOrganization()` (called once in `AppShell`) selects the first workspace on boot — the seeded "My Workspace" on a fresh install — and clears a stale id when that workspace is gone.
- Every org-scoped query includes `orgId` in its query key and gates with `enabled: !!orgId`, so switching orgs refetches automatically.

## API Integration Pattern

When integrating a backend endpoint, always create **two files**: an API module and a React Query hook file.

### 1. API module — `src/api/<domain>.api.ts`

Export a plain object named `<Domain>API` with async methods. Use `axiosInstance.request()` and return typed `response.data`.

```typescript
import type { ApiResponse, PaginatedBriefs, ListBriefsQuery } from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/organizations/current/briefs";

export const BriefsAPI = {
  list: async (params: Partial<ListBriefsQuery> = {}): Promise<ApiResponse<PaginatedBriefs>> => {
    const response = await axiosInstance.request({ url: BASE, method: "GET", params });
    return response.data as ApiResponse<PaginatedBriefs>;
  },
};
```

Rules:

- One file per backend domain/controller (`projects.api.ts`, `teams.api.ts`, …) with a `BASE` path constant.
- Always `axiosInstance.request({ url, method, params?, data? })` — not `.get()` / `.post()`.
- GET passes query parameters via `params`; POST/PUT/PATCH pass the body via `data`.
- Import all request/response types from `@launchstack/api-interfaces`. Never duplicate types locally.

### 2. React Query hooks — `src/hooks/api/use-<domain>.ts`

Each hook file exports a **query-key factory** plus `use<Verb><Noun>` hooks:

```typescript
export const briefsKeys = {
  list: (orgId: string | null, filters: BriefListFilters) => ["briefs", "list", orgId, filters] as const,
  detail: (orgId: string | null, briefId: string) => ["briefs", "detail", orgId, briefId] as const,
};

export function useGetBrief(briefId: string | undefined) {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: briefsKeys.detail(orgId, briefId ?? ""),
    queryFn: () => BriefsAPI.get(briefId as string),
    enabled: !!orgId && !!briefId,
  });
}
```

Rules:

- Key factories take `orgId` first for org-scoped data; include every argument that affects the request.
- Gate queries with `enabled` (`!!orgId`, `!!id`).
- Mutations invalidate through the key factory in `onSuccess` (`queryClient.invalidateQueries({ queryKey: briefsKeys.list(orgId) })` — prefix matching covers filtered variants).
- Cursor-paginated lists use `useInfiniteQuery` with `getNextPageParam: (lastPage) => lastPage.data.nextCursor ?? undefined`.
- For in-progress resources, poll with a conditional `refetchInterval` based on response status (see `useGetBrief`).

### Common mistakes

```typescript
// BAD: fetching in a component with useEffect + axios
// GOOD: const { data, isLoading } = useGetBriefs();

// BAD: defining response interfaces in the frontend
// GOOD: import type { BriefResponse } from "@launchstack/api-interfaces";
```

## Dates & Timezones

The viewer's zone is almost never the right zone here. See the root `AGENTS.md` "Timezones" section for the model and `docs/timezone-audit.md` for the bugs these rules come from.

Three kinds of date reach this app, and each has exactly one correct rendering:

- **A brief's period** (`periodStart` / `periodEnd`) is a pair of local midnights in the *schedule's* zone, **half-open** — `periodEnd` is the next local midnight, not the last instant covered. Format it with `brief.periodTimezone` (or `report.timezone`, same value) — `toLocaleDateString(undefined, …)` prints an IST period a day early to a Los Angeles viewer, and formatting `periodEnd` directly prints a day late. The shared helpers in `components/devsummary/briefs/brief-utils.ts` (`formatPeriod`, `formatRange`) handle both: they take the zone as their third argument and subtract the millisecond internally. Use them rather than reaching for `toLocaleDateString` on a period boundary. An omitted zone means "the viewer's own", which is correct in exactly one place — `generate-dialog.tsx`, where the user picked the window themselves from `datetime-local` inputs.
- **A `YYYY-MM-DD` bucket key** from a chart response is already resolved in the response's zone. Render it with `formatDayKey` from the same file, which anchors `T00:00:00Z` and formats in UTC. **Never pass a key through another zone** — the old `` new Date(`${key}T12:00:00Z`) `` + `timeZone: report.timezone` pattern was off by one for every zone at +12 or beyond (Auckland, Fiji, Kiritimati). There should be zero `T12:00:00Z` anchors in this app.
- **A date the user picked** in `<Input type="date">` is a calendar date in *their* zone. Build the instant from its parts (`new Date(y, m - 1, d)`) before sending it — `new Date("2026-08-14")` parses as UTC midnight, which is what silently dropped a day's worth of briefs from the list filter at UTC+10. `routes/briefs.tsx`'s `localDayBoundary` is the pattern; note that it sends *both* bounds as exclusive local midnights, because the server compares them against a brief's exclusive `periodEnd`.

When a component needs a zone it does not have, thread the existing field down or read it off the brief — do not fall back to UTC and do not add a backend field without checking `packages/api-interfaces/src/responses/` first.

## API access (there is no auth)

Better Auth is gone. What guards the API instead is a per-boot bearer token, because the backend listens on loopback where any local process could reach it.

- `src/env/config-env.ts` resolves `{ baseURL, token }` **before** `createRoot().render()`. Inside the shell it awaits `window.desktop.apiConfig()` (the Electron main process knows the OS-assigned port); headless it falls back to `VITE_API_BASE_URI` + `VITE_DESKTOP_TOKEN`.
- The axios request interceptor sets `x-desktop-token` on **every** request. A request without it is a 401.
- `withCredentials` is gone — there are no cookies.

### Credentials

The user's GitHub PAT, AI provider key (OpenAI or Gemini — the AI page has a provider select, and each provider's key is stored separately) and Slack bot token are pasted on their own integrations page (`routes/integrations-github.tsx`, `routes/integrations-slack.tsx`, `routes/integrations-ai.tsx`, tabbed by `components/integrations/integration-tabs.tsx`); the SMTP password is pasted in `routes/settings.tsx`, which keeps only email, desktop and workspace. None of them is a keychain item. The backend hands the whole set to the Electron main process, which encrypts it with `safeStorage` into a single `userData/secrets.bin` (mode `0600`) — the OS credential store holds the key to that file, not the credentials. The bundle comes back as environment variables at `utilityProcess.fork`, and `SecretsService.update` writes each into `process.env` live so a pasted key works without a restart. Say "encrypted on this machine by your OS credential store" in UI copy, never "in your keychain". **Nothing is ever read back**: `GET /api/local-settings` answers booleans only, so a status pill is the most the UI can show. GitHub is the exception — its status comes from `useGithubInstallations()`, because the token is stored by `POST /api/integrations/github/token` (which also validates it and reconciles the repository list) rather than through the credentials endpoint.

## Client State (Zustand)

Server state lives in React Query; Zustand is only for cross-cutting client state, persisted to localStorage via the `persist` middleware:

- `active-organization-store.ts` — active workspace id (key `launchstack.activeOrganization`).
- `sidebar-prefs-store.ts` — pinned/collapsed sidebar sections (versioned, with `migrate`).

## UI & Feedback

- shadcn/ui primitives in `src/components/ui/` (Radix Nova style, neutral base — see `components.json`). Feature components compose them under `src/components/<domain>/`.
- Merge classNames with `cn()` from `@/lib/utils`; use CVA for variants; icons from `lucide-react`.
- Toasts: `toast.success(...)` / `toast.error(extractErrorMessage(err))` from `sonner` (`extractErrorMessage` is in `@/lib/extract-error`). The `<Toaster/>` is mounted in `main.tsx`.

## Theme & Styling

- Tailwind CSS v4 via `@tailwindcss/vite` — no `tailwind.config.js`; tokens live in `src/index.css` (`@theme inline` + oklch CSS variables, including sidebar and chart tokens).
- Fonts: Hanken Grotesk Variable (sans, also headings) + JetBrains Mono Variable (mono), via `@fontsource-variable/*`.
- Dark mode: custom `ThemeProvider` (`light | dark | system`, localStorage key `launchstack-theme`) toggles the `.dark` class; an inline script in `index.html` applies it pre-render to avoid flash. Use the `useTheme()` hook from `@/components/theme/theme-provider`.

## Environment Variables

None are needed inside the Electron shell — `window.desktop.apiConfig()` supplies the port and the token. The two `VITE_*` vars exist only so the bundle can be driven headless (a bare `vite dev`, or a browser-driven test):

```
VITE_API_BASE_URI=http://127.0.0.1:3000
VITE_DESKTOP_TOKEN=<the backend's API_TOKEN>
```

Read them through `getAppConfig()` from `@/env/config-env`, never `import.meta.env` directly.

## Desktop chrome

External links keep `target="_blank"`. The Electron main process intercepts `setWindowOpenHandler` / `will-navigate` and hands the URL to `shell.openExternal`, so they open in the system browser rather than a second Electron window. Do **not** call `window.desktop.openExternal` from a component — the anchor is the accessible, testable version and main already handles it.

## Shared Packages

- `@launchstack/api-interfaces` — `ApiResponse<T>`, `PaginatedResponse<T>`, plus per-domain request types (`src/requests/`) and response types (`src/responses/`) for auth, briefs, github, organization, collaborators. All API payload types come from here.
- `@launchstack/core` — `formatDate`, `generateId`, `isValidEmail`, `isEmpty`, constants.

Rebuild shared packages after changing them (`pnpm build:packages` from repo root) — apps consume the built output.
