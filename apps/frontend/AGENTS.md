# Frontend — DevSummary (React + Vite + Tailwind v4)

The frontend app for DevSummary: an organization-scoped dashboard for generating AI briefs from GitHub activity (projects, teams, collaborators, repositories, brief schedules, GitHub integrations).

## Stack

React 19, Vite 7, TypeScript 5.9 (strict), TanStack Router v1 (code-based), TanStack Query v5, Zustand v5 (persisted stores), Tailwind CSS v4, shadcn/ui (Radix Nova style), Axios, Better Auth client (email OTP plugin), Zod v4, sonner (toasts), lucide-react (icons), recharts.

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
    auth/                    # Email/Google auth forms
    devsummary/              # App shell, sidebar, topbar + feature components
      briefs/ new-project/ new-team/ schedules/ shared/
    integrations/            # GitHub integration components
    organization/            # Org switcher, invites, roles
    theme/                   # ThemeProvider + toggles
    ui/                      # shadcn/ui primitives
  env/config-env.ts          # Zod-validated env (globalEnv)
  hooks/
    api/use-<domain>.ts      # React Query hooks + query-key factory per domain
    use-bootstrap-active-organization.ts
  lib/                       # auth-client, auth-redirect, extract-error, utils (cn), small formatters
  routes/                    # One page component per route (<name>.tsx exports <Name>Page)
  stores/                    # Zustand stores (active org, sidebar prefs)
  router.tsx                 # ALL route definitions (code-based TanStack Router)
  App.tsx                    # Renders AppShell (protected layout)
  main.tsx                   # ThemeProvider > TooltipProvider > QueryClientProvider > RouterProvider + Toaster
```

`@` maps to `src/` (vite.config.ts + tsconfig).

## Routing

Routes are defined **code-based** in `src/router.tsx` (no file-based routing plugin). Two tiers under the root route:

- **Public auth routes** — `/sign-in`, `/sign-up`, `/google-sign-in`, `/google-sign-up`, `/verify-email`, `/forgot-password`, `/reset-password`, `/auth/error`, `/accept-invite`. Their `beforeLoad` redirects already-authenticated users away.
- **`protectedRoute`** (pathless, `id: "protected"`) — wraps everything else. Its `beforeLoad` calls `AuthAPI.getSession()`: no session → redirect to `/sign-in?redirect=<path>`; unverified email → `/verify-email`. Its component is `App` → `AppShell` (Topbar + SidebarNav + `<Outlet/>`).

To add a page:
1. Create `src/routes/<kebab-name>.tsx` exporting a named `<PascalName>Page` component.
2. In `router.tsx`: `createRoute({ getParentRoute: () => protectedRoute, path: "...", component: ... })` and add it to the `routeTree` children.

Search params are validated with hand-written `validateSearch` narrowing functions (plain `typeof` checks returning a typed object — not Zod). Redirect paths must go through `normalizeRedirectPath` from `@/lib/auth-redirect` (rejects non-relative paths).

## Organization Scoping (cross-cutting)

Almost all data is scoped to the active organization. The pieces:

- `useActiveOrganizationStore` (Zustand, persisted to localStorage) holds `activeOrganizationId`.
- The axios request interceptor (`src/api/axios-client.ts`) injects it as the `X-Organization-Id` header on **every** request; backend URLs use `/api/organizations/current/...`.
- `useBootstrapActiveOrganization()` (called once in `AppShell`) selects the first org on login and clears a stale id when the user loses access.
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

## Auth

- `src/lib/auth-client.ts` creates the Better Auth client (`createAuthClient` with `emailOTPClient()` plugin, `baseURL: globalEnv.apiBaseUri`).
- **Components and routes never call `authClient` directly** — they go through the `AuthAPI` facade (`src/api/auth.api.ts`), which wraps authClient methods (sign-in/up, Google OAuth, session, sign-out, password reset) and raw OTP endpoints, typed via `AuthClientResult<T>` from `@launchstack/api-interfaces`.
- Sessions are cookie-based (`withCredentials: true` on the axios instance) — no token handling in the frontend.
- Auth pages pass `redirect`/`email` search params; build URLs with the helpers in `@/lib/auth-redirect`.

## Client State (Zustand)

Server state lives in React Query; Zustand is only for cross-cutting client state, persisted to localStorage via the `persist` middleware:

- `active-organization-store.ts` — active org id (key `launchstack.activeOrganization`).
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

Validated with Zod in `src/env/config-env.ts` and exposed as `globalEnv` with **camelCase keys**:

```typescript
import { globalEnv } from "@/env/config-env";
globalEnv.apiBaseUri; // from VITE_API_BASE_URI
```

`.env` requires: `VITE_API_BASE_URI=http://localhost:3000`

## Shared Packages

- `@launchstack/api-interfaces` — `ApiResponse<T>`, `PaginatedResponse<T>`, plus per-domain request types (`src/requests/`) and response types (`src/responses/`) for auth, briefs, github, organization, collaborators. All API payload types come from here.
- `@launchstack/core` — `formatDate`, `generateId`, `isValidEmail`, `isEmpty`, constants.

Rebuild shared packages after changing them (`pnpm build:packages` from repo root) — apps consume the built output.
