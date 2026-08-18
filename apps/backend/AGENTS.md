# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Also see the root [CLAUDE.md](../../CLAUDE.md) for monorepo-wide commands and the **DevSummary product spec** (user flows, AI usage, frontend screens). This file covers the backend implementation.

## Commands

All commands run from `apps/backend/`:

```bash
pnpm start:dev              # Watch mode (port 3000) — Temporal client only, runs no worker
pnpm start:debug            # Debug + watch mode
pnpm start:worker:dev       # Temporal worker (watch mode) — polls the task queue, runs activities
pnpm dev:dashboard          # Prints the Temporal UI URL (http://localhost:8080); UI itself comes from `docker compose up -d`
pnpm test                   # Unit tests (Jest) + email render integration (tsx)
pnpm exec jest --testPathPatterns=<pattern>  # Single test file (note: `pnpm test -- <args>` won't filter — the test script chains `jest && tsx`, so args land on tsx)
pnpm test:email             # Email render integration only (real react-email, outside Jest)
pnpm test:watch             # Jest watch mode
pnpm test:e2e               # E2E tests (Vitest + testcontainers; needs Docker)
pnpm test:e2e:watch         # E2E watch mode
pnpm exec vitest run --config vitest.e2e.config.ts <path>  # Single e2e file
pnpm test:cov               # Coverage report
pnpm lint                   # Lint + autofix
pnpm format                 # Prettier on src/ and test/
```

### Database (requires `docker compose up -d` from repo root)

```bash
pnpm db:generate            # Scaffold a blank Kysely migration (kysely migrate:make)
pnpm db:up                  # Apply migrations (kysely migrate:latest)
pnpm db:down                # Rollback last migration (kysely migrate:down)
pnpm db:status              # List migrations (kysely migrate:list)
pnpm db:fresh               # Reset DB: rollback all + re-apply (destructive)
```

## Architecture

### Module Graph

```
AppModule (applies RequestIdMiddleware to all routes)
├── ConfigModule (global)
├── LoggerModule ──────────── nestjs-pino
├── KyselyModule (global) ─── provides KYSELY_DB token
├── TemporalModule.forRoot() (global) ── Temporal client + TemporalProducerService
├── AppAuthModule ─────────── Better Auth + custom EmailOtpController
├── OrganizationsModule ───── registers OrgContextGuard as global APP_GUARD
├── GithubIntegrationsModule ─ GitHub App install, webhooks, repo sync
├── SlackIntegrationsModule ── Slack OAuth install, message posting
├── CommitAnalysisModule ───── commit ingestion + OpenAI analysis
├── GithubCollaboratorsModule ─ repo collaborator sync
├── BriefsModule ───────────── projects, teams, schedules, generation, delivery
└── QueueModule ────────────── noop smoke-test activity/controller
```

Note: this graph is `AppModule`, which the NestJS **API** process (`src/main.ts`) bootstraps. A separate **worker** process (`src/worker.ts`) boots the same `AppModule` via `NestFactory.createApplicationContext()` (DI only, no HTTP listener) to discover `@Activity` providers and run them against the app DB — see "Background jobs (Temporal)" below.

### Entry Point & Body Parsing

**`src/main.ts`** — Bootstrap with `bodyParser: false` and `bufferLogs: true`. Wires the pino logger, CORS (`origin: true`, credentials), the global `AllExceptionsFilter`, and shutdown hooks (`enableShutdownHooks()`, for graceful Nest lifecycle teardown). Port from `PORT` env (default 3000). The API process is a Temporal **client** only — it never runs Temporal activities; that's the separate `src/worker.ts` process.

**Body parsing is opt-in per controller** because the global parser is disabled for Better Auth:

- The Better Auth wrapper is configured with `bodyParser: { rawBody: true }` (`src/auth/auth.module.ts`), which also populates `req.rawBody` — the GitHub webhook controller depends on this for HMAC signature verification.
- Any controller that accepts a JSON body must have `express.json()` applied in its module's `configure()`. Existing examples: `AppAuthModule` (EmailOtpController), `OrganizationsModule`, `BriefsModule`, `QueueModule`. **If you add a new controller with a `@Body()` param and forget this, the body arrives `undefined`.**

### Graceful-degradation config pattern

Integrations load config from env at module init; when required vars are missing the module provides a **stub client whose methods reject with `AppError.*_NOT_CONFIGURED()`** instead of failing boot. Used by: GitHub App (`github.module.ts`), OpenAI briefs client (`briefs.module.ts`), Slack (config nullable). Follow this pattern for new integrations.

### Database (Kysely)

The `KyselyModule` (`src/databases/kysely/kysely.module.ts`) is a **global** module. Inject via the `KYSELY_DB` token:

```typescript
constructor(@Inject(KYSELY_DB) private db: AppDatabase) {}
```

`AppDatabase` is `Kysely<Database>`; both come from the `src/databases/kysely` barrel. The instance runs **`CamelCasePlugin`** — code uses camelCase identifiers (`deletedAt`, `github.commitAnalyses`), SQL gets snake_case. Key conventions:

- **Table keys** in the `Database` interface (`src/databases/kysely/database.types.ts`) are camelCase and schema-qualified: `organizations`, `auth.user`, `github.commitAnalyses`, `briefs.briefSchedules`, …
- **`updatedAt` is NOT auto-touched** — every `updateTable().set({...})` on a table with `updatedAt` must include `updatedAt: new Date()` (including upsert `doUpdateSet`).
- **jsonb columns** (`raw`, `changes`) are typed `Json<T>`: reads are parsed values, writes must be `JSON.stringify(...)` strings.
- **int8/bigint columns** (GitHub ids) come back as JS `BigInt` (pg type parser in `kysely.module.ts`); un-cast `count(*)` / `sum(int8)` aggregates do too — cast `::int` in SQL or wrap `Number()`.
- **text[] columns** (`emailRecipients`, `deliveryEmails`) are plain `string[]` both directions.
- Row types keep the `*Select`/`*Insert` names (`ProjectSelect`, `BriefInsert`, …), exported from the same barrel.

PG schema namespaces: `public` (`demo`, `organizations`, `organization_members`, `organization_invites`), `auth` (Better Auth: `user`, `session`, `account`, `verification`), `github` (`installations`, `repositories`, `repository_branches`, `commits`, `commit_branches`, `commit_analyses`, `collaborators`, `repository_collaborators`, `webhook_events`), `slack` (`installations`), `briefs` (`briefs`, `brief_commits`, `brief_schedules`, `projects`, `project_repositories`, `teams`, `team_collaborators`), `marketing` (`waitlist`).

Migrations live in `migrations/` and are run by **kysely-ctl** (`kysely.config.ts`); `migrations/00001_init.ts` creates the whole schema with Kysely's schema builder (one `create*` helper per PG namespace, `down` drops in dependency order). There is no schema auto-diffing — write DDL by hand and mirror it in `database.types.ts`. Migrations must stay independent of application code: import only from `kysely` and write **literal snake_case** identifiers, since `CamelCasePlugin` is not installed on the migration connection. Temporal's own `temporal`/`temporal_visibility` state lives in **separate databases** on the same Postgres server (provisioned by the `temporalio/auto-setup` container) — not in a schema of this app's database, so there's nothing to reference or avoid in migrations here.

Domain tables use UUID PKs, `created_at`/`updated_at`, and **soft deletes** (`deleted_at`) almost everywhere — repository queries must filter `deletedAt IS NULL`.

### Multi-tenancy (Organizations)

Custom implementation (not Better Auth's organization plugin) in `src/organizations/`.

- Org-scoped requests carry the **`x-organization-id` header**. `OrgContextGuard` (registered as a global `APP_GUARD`) activates on routes decorated with `@RequireOrgRole(level)`: verifies session, membership, and role rank, then attaches the membership to the request.
- Role levels for `@RequireOrgRole`: `'owner' | 'admin' | 'member'` — `member` means *any* role. DB roles are `owner | admin | viewer` (`organization_role` enum).
- `@OrgMembership()` parameter decorator injects `{ organizationId, userId, role }` in controllers.
- Controllers: `api/organizations` (CRUD, `/me`, `/current`, transfer-ownership), `api/organizations/current/members`, invites under both `api/organizations/current/invites` (admin side) and `api/invites/*` (invitee side: list/accept/decline/preview). Invite emails sent by `InviteMailer` via Resend; invite tokens stored hashed.

### Auth (Better Auth)

Auth uses [Better Auth](https://www.better-auth.com/) v1.6.x via the `@thallesp/nestjs-better-auth` wrapper. Better Auth skills are in `.agents/skills/` and a docs index is in `.claude/docs/better-auth.md` (repo root).

**Config:** `src/auth/auth.config.ts` — factory `createAuth()` builds the instance with:

- A dedicated `pg` Pool (`search_path=auth`) with per-model `fields` mappings to the snake_case columns; email + password auth
- Google OAuth (optional — enabled when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` set). Account linking enabled with Google as a trusted provider.
- Token encryption via `databaseHooks` — OAuth access/refresh tokens encrypted at rest (AES-256-GCM, key derived from `BETTER_AUTH_SECRET` via scrypt). **Changing `BETTER_AUTH_SECRET` makes existing encrypted tokens unreadable.**
- Email OTP plugin (6-digit codes, 5-min expiry, sent via Resend using the react-email templates in `src/emails/`)
- OpenAPI plugin (non-production only)

**Crypto:** `src/auth/crypto.ts` — `encrypt()`/`decrypt()` utility. Use `decrypt()` when reading OAuth tokens from the `auth.account` table.

**Routes:** Better Auth endpoints at `/api/auth/*` (handled by the wrapper; the exception filter passes these through untouched). A custom `POST /api/email-otp/send-verification` endpoint lives in `src/auth/email-otp.controller.ts`.

**Decorators** (from `@thallesp/nestjs-better-auth`): `@AllowAnonymous()`, `@OptionalAuth()`, `@Session()`.

**Flow docs:** `docs/auth-signup-flow.md`, `docs/google-oauth-flow.md`, `docs/auth-api.md`.

### Errors

All in `src/common/errors/`:

- **`AppError`** (`application-errors.ts`) — sealed registry of typed error factories (50+ codes covering orgs, invites, integrations, briefs). Throw from services as `throw AppError.PROJECT_NOT_FOUND()`; each code carries its HTTP status and message. Add new codes here with `defineError({ status, message, details? })`.
- **`ApiException`** (`api-errors.ts`) — `HttpException` subclass whose body is the shared `ApiError` shape (`code`, `message`, `details?`).
- **`AllExceptionsFilter`** (`all-exceptions.filter.ts`) — global filter: skips `/api/auth/*`, wraps plain `HttpException`s, logs and converts unknown errors to a generic 500 `ApiException`.

### Logging

`nestjs-pino` configured in `src/logger/pino.config.ts`:

- `LOG_LEVEL` env (default `info`); redacts `authorization`/`cookie` headers.
- Request IDs: honors incoming `x-request-id` or generates a UUID; `RequestIdMiddleware` echoes it on responses.
- Transports: dev = pretty console + rolling file; production = file only. File via `pino-roll` at `LOG_FILE_PATH` (default `../../logs/app.log`, i.e. `<repo-root>/logs/`), max size/retention via `LOG_FILE_MAX_SIZE`/`LOG_FILE_KEEP_FILES`.
- Use the standard NestJS `Logger` class in services/handlers — it routes through pino (`app.useLogger(app.get(Logger))` in main.ts).

### Background jobs (Temporal)

Background jobs run on [Temporal](https://temporal.io/) via a thin in-house bridge layer in `src/temporal/` (replaces the old pg-boss integration; `src/queue/` now only holds the `noop` smoke-test activity/controller).

**Topology.** A single fused Temporal server (`temporalio/auto-setup:1.25.2`) runs alongside the app's existing Postgres (port 11753), using **Postgres advanced visibility** (`DB=postgres12`, `ENABLE_ES=false` — no Elasticsearch). It provisions its own `temporal` and `temporal_visibility` databases on that same Postgres instance; only the Temporal server process talks to them. The **Temporal Web UI** (`temporalio/ui:2.34.0`) is at **http://localhost:8080**, and `temporalio/admin-tools:1.25.2-tctl-1.18.1-cli-1.1.2` provides the `temporal` CLI used for search-attribute setup (below). All four services (`postgres`, `temporal`, `temporal-ui`, `temporal-admin-tools`) are defined in the repo-root `docker-compose.yaml`.

**Two processes.** The NestJS **API** (`src/main.ts`) is a Temporal client only: it starts workflows and queries visibility, and runs no worker. A separate **worker** process (`src/worker.ts`) polls the task queue and executes activities against the app DB via Kysely — it holds zero Temporal-DB connections, only app-DB ones. Run it with `pnpm start:worker:dev` (or `pnpm dev:worker` from the repo root); production runs `pnpm start:worker` (`node dist/worker.js`) or the root `pnpm start:prod:worker`. The repo-root `pnpm dev` runs frontend + API + worker + packages together.

**Build output & plain-`node` launch.** `tsconfig.build.json` pins `rootDir` to `./src` (excluding `kysely.config.ts`, `migrations/`, and `docs/`, the only non-`src` `.ts` files in this package) so `nest build` emits a flat `dist/` — `dist/main.js` and `dist/worker.js` directly, not nested under `dist/src/`. This is what makes `start:prod`/`start:worker` (`node dist/main`/`node dist/worker.js`) and the root `start:prod:backend`/`start:prod:worker` scripts resolve correctly. `express` is a **direct** dependency (not just transitive via `@nestjs/platform-express`) so `auth.module.ts`/`queue.module.ts`'s `import * as express from 'express'` resolves under a plain `node dist/...` launch with no `NODE_PATH` needed.

**Bridge layer (`src/temporal/`):** `TemporalModule.forRoot()` is global and provides `TEMPORAL_CLIENT` (a `@temporalio/client` `Client`) and `TemporalProducerService`.

**Producer API (`TemporalProducerService`):** inject anywhere and call:

- `start(workflowType, opts)` — starts a new workflow execution (auto-generates a `workflowId` unless `opts.workflowId` is given); resolves to the `workflowId` — the `{ jobId }` value returned by async endpoints.
- `startDeduped(workflowType, opts)` — same, but requires `opts.workflowId` and sets `workflowIdConflictPolicy: 'USE_EXISTING'` (singleton/dedup semantics, replacing pg-boss's `sendOnce`).
- `opts` also takes `args`, `searchAttributes`, and `startDelay` (replacing pg-boss's `sendAfter`).

**Defining an activity:** mark a DI-bound method with `@Activity('name')`; `activity-registry.ts` discovers all `@Activity`-decorated providers via NestJS's `DiscoveryService`, and `src/worker.ts` binds the result into `Worker.create({ activities })` on boot.

```ts
// some feature's activities provider
@Injectable()
export class MyThingActivities {
  @Activity('feature.myThing')
  async myThing(input: { id: string }): Promise<void> {
    // business logic — runs in the worker process, against the app DB
  }
}
```

Workflows live in `src/temporal/workflows/*.ts` — pure, deterministic TypeScript with **no NestJS imports**, using `proxyActivities<Activities>()` (see `workflows/activity-proxies.ts` for the five shared retry profiles: `standard`/`slow`/`twice`/`once`/`ingest`), `startChild()`, `continueAsNew()`, and `sleep()`.

**Task queue:** a single queue, `TEMPORAL_TASK_QUEUE` (env, default `launchstack`).

**Search attributes:** two custom Keyword attributes — `OrganizationId` and `Phase` (`fetching|analyzing|generating`) — power the frontend's background-jobs toast. They're set on every org-scoped workflow start (child workflows inherit `OrganizationId` from the parent's args); LOC-stats workflows omit both (system-scoped work, never surfaced per-org). **Registration is a prerequisite for these starts, not just for querying**: Temporal rejects `StartWorkflowExecution` outright if it carries a custom search attribute that isn't registered on the namespace, so on a fresh cluster every org-scoped workflow start (collaborator sync, commit backfill, analysis, brief generation) would fail until this runs. `SchedulesBootstrap` (`src/temporal/schedules.bootstrap.ts`) now **auto-registers both attributes on API boot** via `client.connection.operatorService.addSearchAttributes()`, idempotently (an `ALREADY_EXISTS` gRPC error is logged and swallowed, like the schedule-create call it runs alongside) and gated the same way (`TEMPORAL_MANAGE_SCHEDULES`). `apps/backend/scripts/register-search-attributes.sh` remains as a manual fallback (e.g. to register ahead of first API boot, or against a cluster with schedule management disabled) — wraps `temporal operator search-attribute create` against the `temporal-admin-tools` container, safe to re-run. `JobActivityService` (`src/jobs-activity/`) counts Running workflows per phase via Temporal Visibility (`client.workflow.count`); the `JobActivityResponse { active, fetching, analyzing, generating }` contract is unchanged, so the frontend needed no changes.

**Workflow / activity catalog:**

| Workflow | Activities | Phase SA | Purpose |
| --- | --- | --- | --- |
| `NoopWorkflow` | `noop.run` | — | Smoke test |
| `SyncRepoCollaboratorsWorkflow` | `collaborators.syncRepo` | `fetching` | Syncs repo collaborators (on connect, webhook, or manual) |
| `ScanRepositoryWorkflow` | `commits.backfillFromLatest` (+ starts `AnalyzeRepoWorkflow`) | `fetching` | One per (repository, branch); started when a branch becomes tracked, kicks off backfill + analysis |
| `BackfillCommitsWorkflow` | `commits.backfill` | `fetching` | Pulls a specific commit range for one (repository, branch) from the GitHub API |
| `IngestNewCommitsWorkflow` | `commits.planIngest`, then `commits.backfill` (resume) or `commits.backfillFromLatest` (adopt) (+ starts `AnalyzeRepoWorkflow`) | `fetching` | One incremental read of a (repository, branch): plans the window, fetches the tail, analyses it. Started by the `push` webhook and by the nightly sweep |
| `SweepRepositoriesWorkflow` | `commits.listSweepTargets` (+ starts `IngestNewCommitsWorkflow` per tracked pair) | — (system-scoped; children carry the org) | Fired nightly by the `github-sweep-daily` Schedule; one incremental read per tracked (repository, branch), pages of 200 with continue-as-new |
| `AnalyzeRepoWorkflow` | `analysis.planRepoAnalysis`, `analysis.analyzeCommit` | `analyzing` | Fans out per-commit OpenAI analysis in bounded batches; continues-as-new past a size threshold |
| `GenerateBriefWorkflow` | `briefs.markGenerating`, `briefs.generateContent`, `briefs.deliver` | `generating` | Generates one brief (scope → commits → OpenAI), then delivers |
| `BackfillBriefsWorkflow` | `briefs.planBackfill` (+ starts `GenerateBriefWorkflow` per id) | `generating` | On schedule creation, creates historical briefs (no delivery) |
| `DispatchDueBriefsWorkflow` | `briefs.claimDue` (+ starts `GenerateBriefWorkflow` per due brief) | `generating` | Fired by the `briefs-dispatch-due` Schedule; finds due schedules, creates pending briefs |
| `BackfillLocStatsWorkflow` | `loc.zeroFillAndFindMissing` (+ starts `BackfillRepoLocStatsWorkflow` per repo) | — (system-scoped) | Defined but **not started from application code** — trigger manually via the Temporal CLI/UI if a LOC backfill is ever needed again |
| `BackfillRepoLocStatsWorkflow` | `loc.pageRepo` | — | Pages LOC stats per repo; continues-as-new until history is exhausted |

**Schedules:** two, both created idempotently on API boot by `SchedulesBootstrap`, both gated by `TEMPORAL_MANAGE_SCHEDULES` (default `true`; `src/worker.ts` sets it to `false` so only one process creates them):

- **`briefs-dispatch-due`** — interval `BRIEFS_DISPATCHER_INTERVAL_SECONDS` (default 60s), overlap policy `SKIP` (only one dispatch run in flight at a time), action = start `DispatchDueBriefsWorkflow`. Replaces the old self-rescheduling dispatch loop.
- **`github-sweep-daily`** — cron `55 23 * * *` in `Etc/UTC`, overlap `SKIP`, action = start `SweepRepositoriesWorkflow`. The nightly catch-up behind the `push` webhook. Both values are the `SWEEP_CRON`/`SWEEP_TIMEZONE` constants in `schedules.bootstrap.ts`, not env vars — editing them is the whole change, since the spec is synced on boot for an existing cluster.

Both are **synced when they already exist**, because `schedule.create` is a no-op on an existing Schedule and a changed interval or cron would otherwise never reach a running cluster. The interval is patched in place; the sweep's spec is *replaced* wholesale, since a described cron comes back normalised into `structuredCalendar` and writing `cronExpressions` alongside it would leave both in the spec.

**Retry / dedup / delay mapping** (from the old pg-boss job defs; see `activity-proxies.ts` for the concrete retry profiles):

| pg-boss | Temporal |
| --- | --- |
| `retryLimit N` | `RetryPolicy.maximumAttempts = N + 1` |
| `retryDelay` | `initialInterval` |
| `retryBackoff: true` | `backoffCoefficient: 2` (else `1`) |
| `sendOnce(key)` | `startDeduped(type, { workflowId: key })` → `workflowIdConflictPolicy: 'USE_EXISTING'` |
| `sendAfter(delaySeconds)` | `start(type, { startDelay })`, or an in-workflow `sleep()` before `continueAsNew()` for self-rescheduling loops |

**Smoke test:**

```bash
curl -X POST http://localhost:3000/api/_internal/queue/noop \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $INTERNAL_API_TOKEN" \
  -d '{"message":"hello"}'
```

Returns `201 { data: { jobId: "NoopWorkflow:..." }, message: "enqueued", success: true }`. Watch the workflow run to Completed in the Temporal UI at http://localhost:8080.

**Operational notes:**

- **First-run setup.** `temporalio/auto-setup` provisions the `temporal`/`temporal_visibility` databases on first boot. Search attributes are auto-registered on API boot by `SchedulesBootstrap` before org-scoped workflows can start (Temporal rejects a start carrying an unregistered custom search attribute); `apps/backend/scripts/register-search-attributes.sh` is a manual fallback for the same registration (safe to re-run).
- **Concurrency.** A single task queue (`launchstack`) with worker-level concurrency caps (`maxConcurrentActivityTaskExecutions`/`maxConcurrentWorkflowTaskExecutions`, both 20 in `src/worker.ts`) stands in for pg-boss's per-queue `localConcurrency`. If a specific activity type needs a hard cap, split it onto its own task queue with a dedicated worker.
- **Legacy cleanup.** The old `pgboss` Postgres schema (from the pre-migration system) is orphaned after cutover; dropping it is a separate manual step, not automated by anything here.

## DevSummary Domain

### HTTP route map

All org-scoped routes require the `x-organization-id` header and pass through `OrgContextGuard`.

| Prefix | Controller | Notes |
| --- | --- | --- |
| `api/organizations` | organizations | create, `/me`, `/current` (get/patch/delete), transfer-ownership |
| `api/organizations/current/members` | members | list, role update, leave, remove |
| `api/organizations/current/invites` + `api/invites/*` | invites | admin side + invitee side; `/invites/preview` is public |
| `api/organizations/current/projects` | briefs/projects | CRUD + `PUT /:id/repositories` |
| `api/organizations/current/teams` | briefs/teams | CRUD + `PUT /:id/collaborators` |
| `api/organizations/current/brief-schedules` | briefs/schedules | CRUD + pause/resume |
| `api/organizations/current/briefs` | briefs/generation | list (cursor pagination + filters), get (with commit-type counts), `GET /:id/commits`, `POST /generate` (202 + jobId) |
| `api/organizations/current/collaborators` | github/collaborators | org-wide collaborator list |
| `api/integrations/github/installations` | github | list, `POST /start` (install URL), `GET /callback`, sync, disconnect |
| `api/integrations/github/webhook` | github | public; HMAC-verified, events stored idempotently (delivery UUID PK), jobs enqueued (`member` → collaborator sync, `push` → incremental commit ingestion) |
| `api/integrations/github/repositories` | github | `GET /:repoId/branches` (live from GitHub), `POST /branches` (batch: set each repo's branch **once** + start ingestion, 202; 409 on an already-configured repo) |
| `api/integrations/github/repositories/:id/collaborators` | github/collaborators | list, `POST /sync` |
| `api/integrations/github/repositories/:repoId/commits` | github/commit-analysis | commit/analysis endpoints, backfill triggers |
| `api/integrations/slack/installations` | slack | list, `POST /start`, `GET /callback`, disconnect (revokes token) |
| `api/integrations/slack` | slack | `GET /channels`, `GET /members`, `POST /messages` |
| `api/email-otp` | auth | `POST /send-verification` |
| `api/waitlist` | waitlist | public; `POST /` stores the email in `marketing.waitlist` (unique index dedupes a repeat), rate limited to 5/min per IP in process memory |
| `api/_internal/queue` | queue | noop smoke test (`x-internal-token`) |
| `api/health` | health | public; `GET /` readiness (Postgres + Temporal, 200/503), `GET /live` liveness (no dependencies, always 200) |

### Briefs pipeline (`src/briefs/`)

Scope types: **project** (repo group), **team** (collaborator group), **collaborator**, **repository** (optionally narrowed to one branch via `scope_branch`, guarded by a check constraint that only a `repository` scope may set it; `BriefScopeResolver` returns it as `branchFilter` and every commit query — generation, backfill bounds, and all five report queries — honours it as an `EXISTS` against `commit_branches`, never a join, so a commit on two branches is not counted twice). Projects/teams are org-scoped soft-deleted groupings with junction tables.

A **repository** scope is validated against the tracked set at the boundary — both `BriefSchedulesService.assertScopeInOrg` and `BriefsService.assertScopeInOrg` reject a repository with no branch chosen (`GITHUB_REPOSITORY_BRANCH_NOT_CONFIGURED`) and a `branch` that is not the one it reads (`GITHUB_REPOSITORY_BRANCH_NOT_TRACKED`). Without that, a schedule over an inert repository generates and *delivers* an empty brief on every tick forever with nothing pointing at the cause. Project and team scopes are deliberately not blocked the same way — their membership changes independently of the schedule — so the frontend labels unconfigured repositories in the project picker instead.

1. **Schedule** (`schedules/`) — CRUD with cadence (daily/weekly/monthly at a time in a timezone). `CadenceService` computes period windows and `nextRunAt`. Creating a schedule starts a `BackfillBriefsWorkflow`.

   **`CadenceService` deliberately uses no date library.** `date-fns-tz` was removed from it: `toZonedTime`, `formatInTimeZone` and `fromZonedTime` all probe the offset by reading a server-local `Date`'s fields, so every result depended on the *server's* zone — under `TZ=America/New_York` an `Asia/Kolkata` 02:30 schedule fired at 03:30 on the US spring-forward day, and under `TZ=America/Santiago` (which transitions at midnight) period boundaries lost their first hour and `windowsInRange` looped forever on the doubled local midnight. In its place: `wallClockIn` (a cached `Intl.DateTimeFormat('en-CA', { hourCycle: 'h23' })` per zone), `offsetAt`, and `zonedInstant` (two-pass offset resolution, rounding a spring-forward gap up to the first valid local instant), with calendar arithmetic on `YYYY-MM-DD` keys. `@date-fns/tz@1.5` — date-fns v4's companion, a genuinely different design from `date-fns-tz@3` — was re-evaluated against this file in August 2026 and **also loses**, on two of four correctness checks. It resolves a nonexistent wall clock to *requested + gap width* (Lord Howe 02:15 → 02:45, want 02:30, the transition), wrong on 392 of 522 probes across all 130 forward transitions in tzdata 2026; and it still reads the system `getTimezoneOffset()` to compensate for the process zone, so `America/Santiago` 23:45 moves an hour between `TZ=UTC` and `TZ=America/New_York`, and `Pacific/Chatham` local midnight — i.e. `zonedStartOfDay`, which stored period boundaries depend on — moves with the host. It passes the "window is exactly the local day" check only by coincidence: day boundaries ask for 00:00 and every midnight gap starts *at* 00:00, so requested + gap width happens to equal the transition there and nowhere else.

**Do not reintroduce a date library here**, and do not "simplify" the two-pass resolution — it is what makes the result independent of the process zone. Semantics are byte-identical to the old implementation under `TZ=UTC`; the server-zone specs in `schedules/__tests__/cadence.service.server-tz-*.spec.ts` are the regression net.

   **Periods are half-open: `period_start <= authored_at < period_end`.** `PeriodWindow.end` is the *next* local midnight, exclusive — not `23:59:59.999`. An inclusive end did not tile: on a 25-hour fall-back day the repeated hour fell between one window's end and the next window's start and landed in no brief. Three things follow, and all three have been bitten already:

   - Every commit query bounds the period with `<`, never `<=`.
   - Every *label* formats `period_end - 1ms`, or it names a day the brief does not cover. Three call sites, not one: `formatPeriodLabel`, the `Period:` header in `buildBriefUserPrompt` (a label the *model* reads and repeats in prose), and the frontend helpers in `brief-utils.ts`.
   - The brief-list filters compare against the stored exclusive end with `period_end > from` and `period_end <= to`, and the frontend sends both bounds as exclusive local midnights. `>=` on `from` would wrongly match the brief covering the previous day, which now ends at exactly that instant.

   The exclusive end is `startOfDay(nextCalendarKey, tz)` — the *next key's* midnight, never `+24h` and never `+1ms`. That makes tiling structural rather than arithmetic: a window's `end` and the next window's `start` are the same expression on the same key, so whatever the two-pass resolution decides for an ambiguous or nonexistent local midnight, both sides get the identical instant. Verified across all 418 IANA zones × 3 cadences × a year: 180,524 windows, zero gaps or overlaps.
2. **Dispatch** (`temporal/` + `generation/activities/`) — a Temporal **Schedule** (`briefs-dispatch-due`, created on API boot by `SchedulesBootstrap`, interval `BRIEFS_DISPATCHER_INTERVAL_SECONDS` default 60s, overlap policy `SKIP`) fires `DispatchDueBriefsWorkflow`, which runs the `briefs.claimDue` activity (`BriefActivities.claimDue`), then starts a `GenerateBriefWorkflow` per returned brief.

   `claimDue` runs in **two phases, one transaction per schedule** — never one transaction for the whole batch. Phase 1 reads up to `BRIEFS_DISPATCH_BATCH_SIZE` due schedule ids; phase 2 opens a transaction per id that re-locks that single row (`FOR UPDATE SKIP LOCKED`, re-checking the same due predicates), creates the brief rows, and advances `nextRunAt`. **Preserve the per-schedule transaction boundary**: a batch-wide transaction means one bad row aborts every tenant's dispatch while the per-row `catch` logs success, because Postgres answers `COMMIT` with `ROLLBACK` without raising.

   Three related guarantees live here: missed periods are all created but only the most recent one gets `deliver: true` (the rest are backfill-style, so a week of downtime cannot fan out a week of emails); briefs left `pending` past `BRIEFS_PENDING_REAP_MINUTES` are re-dispatched, covering a worker that died after the claim committed; and a schedule that fails dispatch repeatedly accumulates `dispatch_failure_count` and is auto-paused at 5, so it stops holding the oldest `next_run_at` and starving healthy schedules. `briefs_schedule_period_active_unique` makes a duplicate claim a `23505` the claim path treats as "already claimed".
3. **Generate** — `GenerateBriefWorkflow` runs `briefs.markGenerating` then `briefs.generateContent` (`BriefActivities`, backed by `BriefGeneratorService`) → `BriefScopeResolver` (scope → repo IDs + optional author filter) → fetch commits + their analyses → `buildBriefUserPrompt()` (truncates to `BRIEFS_MAX_PROMPT_CHARS`, default 30k) → `OpenAIBriefClient` (OpenAI `responses.parse()` with Zod `BriefOutputSchema` → `{ title, summary }`; model `OPENAI_BRIEF_MODEL`, default gpt-4o-mini). Stores title/summary/token counts and links commits via `brief_commits` (`BriefCommitsRepository.replaceForBrief()`). Zero-commit periods produce "no activity" briefs without an LLM call.
4. **Deliver** (`delivery/`) — `BriefDelivererService` sends email (Resend, HTML from `BriefRenderService`) and Slack (markdown via `SlackMessagesService`) in parallel, then sets brief status `delivered`/`failed` (+ `failureReason`) and `schedule.lastSentAt`. Backfilled briefs skip delivery.

Brief listing uses base64url cursor pagination with filters (scheduleId, scopeType, period, excludeNoActivity).

**A brief's period carries its own timezone.** `period_start`/`period_end` are instants, but they are *local midnights in the schedule's zone*, so nothing can render or bucket them without that zone — and a schedule's `timezone` is editable, so reading the live schedule row re-tiles history. `briefs.briefs.period_timezone` is snapshotted at creation (from the schedule; `'UTC'` for on-demand briefs, and the column's default, which is exactly what pre-existing rows already behaved as). Every consumer reads that column: the `briefInfoTitle` label, `buildBriefUserPrompt`'s `Period:` header, `BriefReportService`'s day tiling, and `BriefResponse.periodTimezone` for the frontend. **Anything new that formats or buckets a brief period reads it too** — never the schedule, never UTC, never the viewer's zone.

`BriefReportRepository` takes days as **instant ranges** and names no zone in SQL at all (`ReportDay { key, from, to }`, resolved in `BriefReportService`). Keep it that way: a schedule may hold a legacy alias like `Asia/Calcutta`, which every JS runtime accepts and a Postgres without `tzdata-legacy` rejects outright, taking the whole report down.

**A brief covers what *landed* on the tracked branch during the period**, so commit selection runs on **`committed_at`** — the same clock the ingest high-water mark uses (`findNewestCommittedAtOnBranch`; GitHub's `since` filters on commit date). Keep both halves on one clock. When they disagreed, a rebased branch was fetched, stored and analyzed on its committer date and then failed selection on its stale author date, landing in *no* brief at all: the period it belonged to was closed, `briefs_schedule_period_active_unique` blocks a second brief for it, and `claimDue` only walks forward.

`briefs.briefs.commit_clock` snapshots which clock a brief was generated under (`'authored'` for everything predating the switch, `'committed'` since). `BriefReportService` reads it and threads it into every period-bounded query. **It is a fixed identifier, never an interpolated string** — map the union to `sql.ref(...)` through a lookup that throws on anything unexpected. Without the snapshot, old reports would print totals contradicting the `commit_count` on their own brief, which is what the comment at `brief-report.repository.ts:115-120` guards.

Two things deliberately left on author date: `analytics/` dashboard buckets (a live-queried surface where nothing can be lost, and switching would shift every historical chart), and, unavoidably, teams that merge with `--no-ff` — those branch commits keep their original committer dates, so their landing date is off by the branch's lifetime. The exact fix for that is a landing timestamp stored at ingest time, resolved differently for a historical read than an incremental one.

### GitHub integration (`src/integrations/github/`)

- Uses a **GitHub App** (`@octokit/app`), not user OAuth tokens. `GithubAppClient` wraps installation-scoped API calls (repos, commits, collaborators).
- Install flow: `POST /start` returns the GitHub install URL with a JWT state token (signed with `BETTER_AUTH_SECRET` by `StateTokenService`); `GET /callback` verifies state, reconciles repos (upsert + soft-delete missing), starts `SyncRepoCollaboratorsWorkflow` per connected repo, and redirects to `<FRONTEND_URL>/integrations/github/setup?connected=1`.
- **Commit ingestion is never started by connect or sync.** A repository is read only on the branch it is tracked on — `github.repository_branches`, partial-unique on `(repository_id, branch) where deleted_at is null`. No live row = the repo is inert (no fetch, no analysis, no contribution to briefs). `RepositoryBranchesService.setBranches` (`POST /api/integrations/github/repositories/branches`, admin) sets each repository's branch and is the only caller that starts `ScanRepositoryWorkflow`, with the request's `lookbackDays` (30/90) instead of the old hardcoded 365. `MAX_HISTORY_DAYS` (90, in `@launchstack/api-interfaces`) is the ceiling on history *everywhere* — this window, the manual backfill endpoint's `days`, and a schedule's brief backfill, which `planBackfill` clamps to it. Widening it means widening the up-front OpenAI bill for connecting a repository, which is a pricing decision, not a config tweak. **One repository reads one branch**: the request carries a single `branch` per repository, and nothing writes a second row. The table stays a set (and the queries stay branch-filtered) so a multi-branch mode can arrive without a migration or a data backfill.
- **The choice is write-once.** `RepositoryBranchesRepository.setBranchOnce` refuses any second write for a repository — no swapping, no second branch — and the service turns that into `GITHUB_REPOSITORY_BRANCHES_LOCKED` (409). It is deliberately restrictive for now: changing it re-reads history and spends OpenAI tokens, and because attribution lives in `commit_branches` the old branch's commits would stay behind and keep appearing in briefs. The check and the insert run in one transaction behind a `SELECT … FOR UPDATE` on the repository row, because two admins pressing Start at once would otherwise both read an empty set and insert *different* branches, which no unique index catches. `deleted_at` stays on the table so untracking has somewhere to land when it is designed.
- **Branch is an argument, never a lookup.** `ScanRepositoryWorkflow` / `BackfillCommitsWorkflow` and the `commits.backfillFromLatest` / `commits.backfill` activities all carry `branch`; `CommitBackfillService` verifies it is still tracked and throws `GITHUB_REPOSITORY_BRANCH_NOT_TRACKED` otherwise (a stale workflow must not resurrect an untracked branch). Workflow dedup keys are `scan:<repositoryId>:<branch>` and `backfill:<repositoryId>:<branch>:<sinceDate>`. `POST /repositories/:repoId/commits/backfill` fans out one workflow per tracked branch (or takes an explicit `branch`), and refuses with `GITHUB_REPOSITORY_BRANCH_NOT_CONFIGURED` when none are tracked.
- **Commit attribution:** `github.commit_branches` records which branches a commit was seen on — one row per `(commit_id, branch)`, many per commit, because branches share ancestry. `CommitsRepository.upsertMany` returns ids for already-present commits too (`DO UPDATE` + `RETURNING`, not `DO NOTHING`) so a commit first ingested from another branch still gets attributed; `linkToBranch` is idempotent. Adding a second branch is therefore cheap: shared commits keep their cached analyses, and only divergent commits cost OpenAI tokens.
- Branch lists come from `GithubAppClient.listBranches` (GraphQL `refs` ordered by commit date, capped at 3 pages, `truncated` flag) — `GET /api/integrations/github/repositories/:repoId/branches`. REST's `/branches` carries no commit date, which is why this is GraphQL.
- There is no untrack path yet. If one is added, it must keep the commits and their `commit_branches` rows — `briefs.brief_commits` references commits from briefs already delivered — and re-tracking should revive the soft-deleted row rather than re-fetch from scratch.
- Webhooks: HMAC-SHA256 verified (`WebhookVerifierService`, raw body required), stored in `github.webhook_events` keyed by GitHub delivery UUID for idempotency, then dispatched to jobs (`member` events → collaborator sync, `push` events → commit ingestion).
- **`push` is the ongoing-ingest trigger.** Branch setup reads the history window *once*; every commit after it arrives via a `push` delivery (a PR merge included — it lands as a push to the base branch). The GitHub App is subscribed to `push` (deliveries have been arriving in `github.webhook_events` since before this was handled); the subscription is dashboard config, not code, so a new App registration has to carry it or the repository stops updating after its initial read and briefs for later periods report no activity. A gap costs nothing to recover: the window is derived from the newest commit stored on the branch, not from the delivery, so the next push re-reads everything missed while nothing was consuming the event. `parsePushEvent` (`services/push-event.ts`) drops tag pushes, branch deletions, and payloads naming no commit before anything is routed; the rest start `IngestNewCommitsWorkflow`, deduped on `push:<repositoryId>:<branch>:<headSha>` so a redelivery reuses the run.
- **A nightly sweep is the backstop.** The `github-sweep-daily` Schedule fires `SweepRepositoriesWorkflow` at 23:55 UTC, which starts one `IngestNewCommitsWorkflow` per tracked (repository, branch) — deduped on `sweep:<repositoryId>:<branch>:<runDate>` — regardless of whether a webhook arrived. It covers what a webhook cannot: a delivery GitHub never sent or we rejected, a stretch where the worker was down, an App registration missing the `push` subscription, commits pushed while the branch was being configured. It is cheap by construction: every child runs the same gate, so a repository with nothing new costs two indexed queries and no GitHub call. Fan-out pages 200 pairs per run and continues as new; the run date is stamped by the activity (a workflow cannot read a clock) and carried across the boundary so every child of one sweep shares an id namespace. The sweep itself carries **no** `OrganizationId` (it spans tenants); each child carries its own.
- **Both triggers fetch only what is missing**, decided by `commits.planIngest` (`CommitBackfillService.planIngest`) on the worker rather than in the webhook request. Two gates: the named shas are checked against what is already attributed to that branch (join to `commit_branches`, not `commits` alone — a commit stored from another branch is not yet in this branch's briefs), and the window starts at `min(newest committedAt on the branch, earliest named timestamp)` rather than a lookback window. `committedAt` because that is what GitHub's `since` filters; the `min` because a force-push can rewind the branch to an older base. The sha gate is skipped when the caller names no shas (the sweep) or when GitHub truncated the payload, since the shas it *didn't* name prove nothing. A push or sweep for a branch the repository does not read is a no-op — one repository reads one branch.
- **A branch with no stored history is adopted, not skipped.** `planIngest` returns `mode: 'adopt'` (there is no high-water mark to resume from) and `IngestNewCommitsWorkflow` runs `commits.backfillFromLatest` with `ADOPT_LOOKBACK_DAYS` (30, a workflow constant) — the same lookback-bounded first read branch setup performs. That is what recovers a repository whose setup scan failed, one tracked while the worker was down, or one inert since before ingestion existed. Adoption is keyed on "nothing stored", **not** on the trigger, on purpose: a push arriving at a never-read branch would otherwise store only the commits it named and resume from that mark forever, hiding the older history with no signal. A genuinely empty repository costs one `getLatestCommitDate` call per sweep (null window → no analysis child, nothing stored, so it is adopted again next night).
- **Commit analysis** (`commit-analysis/`): each non-merge commit's message + diff (capped at 60k chars) goes to OpenAI (`OPENAI_COMMIT_ANALYSIS_MODEL`) with a Zod structured output: `commit_type` (`fix|feature|optimization|refactor|docs|test|chore`), `summary`, `changes[]`. Results cached per commit in `github.commit_analyses` with token counts, truncation flag, and status (`analyzed|skipped_merge|skipped_empty|failed`).

### Slack integration (`src/integrations/slack/`)

OAuth v2 flow mirroring GitHub's (state token → `GET /callback` → code exchange). One active installation per org (partial unique index where `deleted_at IS NULL`); bot token stored in `slack.installations` with the raw OAuth response. `SlackClient` wraps `@slack/web-api` (postMessage, paginated channel/member listing, token revoke on disconnect). Default scopes: `chat:write,channels:read,groups:read,users:read,channels:join`.

### Emails (`src/emails/`)

React Email templates rendered to `{ subject, html, text }` via `@react-email/render`: `otp-email.tsx` (verification / sign-in / password-reset variants) and `invite-email.tsx`. Sent through Resend. Because react-email is mocked in Jest, `pnpm test` also runs `src/emails/__tests__/render-integration.ts` with tsx to exercise real rendering.

## Testing

**Unit tests**: `*.spec.ts` under `src/` (convention: colocated `__tests__/` dirs). ESM-only packages don't work with Jest (CJS), so manual mocks in `src/__mocks__/` are wired via `moduleNameMapper` in package.json for: `@octokit/app`, `@slack/web-api`, `@thallesp/nestjs-better-auth`, `better-auth` (+ `/api`, `/plugins`), `openai` (+ `/helpers/zod`), `resend`, `@react-email/render`, `@react-email/components`.

Activities (the migrated business logic, e.g. `BriefActivities`, `NoopActivity`) are unit-tested as plain NestJS providers — most current `*.spec.ts` files under `src/temporal/`, `src/briefs/generation/activities/`, etc. exercise them directly. Workflow orchestration itself (`src/temporal/workflows/__tests__/`) is tested with `@temporalio/testing`'s `TestWorkflowEnvironment` (time-skipping), mocking activities, for the orchestration-critical paths: `GenerateBriefWorkflow` (deliver on/off, empty, scope-deleted) and `AnalyzeRepoWorkflow` (fan-out + continue-as-new boundary).

When adding a new ESM-only dependency used in tested code, add a mock + `moduleNameMapper` entry.

**Timezone-sensitive tests** must pin the *process* zone, and `process.env.TZ = …` inside a spec does not do it — under Jest 30 the sandboxed `process.env` never reaches V8's timezone cache, so the assignment silently no-ops and the test runs in the boot zone. Use the 25-line custom environment instead, selected per file by docblock:

```ts
/**
 * @jest-environment <rootDir>/../test/timezone-jest-environment.js
 * @jest-environment-options {"timezone": "America/New_York"}
 */
```

Pick a zone and a date that actually transition, or the test proves nothing — the whole suite passed under `TZ=America/Santiago` while the cadence bug was live. `cadence.service.server-tz-new-york.spec.ts` (gap at 02:00, `2026-03-08`) and `cadence.service.server-tz-santiago.spec.ts` (gap at 00:00, `2026-09-06`) are the worked examples, and each asserts the harness itself first.

**E2E tests** (`test/e2e/`): Vitest, not Jest — `better-auth` is ESM-only and cannot load in Jest's CJS runtime, which is why the unit tests mock it. The e2e suite runs the real thing against a `postgres:18` testcontainer (schema built by `kysely migrate:latest`, cloned per test file via `CREATE DATABASE … TEMPLATE`) and a real Temporal CLI dev server from `@temporalio/testing`. `resend` is the only mocked module. Note that each booted app holds **two** pg pools — the application Kysely pool and Better Auth's own from `createAuth()` — and only the first is closed by DI, so the harness ends the second explicitly. Config: `vitest.e2e.config.ts`; env: `.env.test`; details: `test/e2e/README.md`.

## API Conventions

- All non-auth responses use `ApiResponse<T>` from `@launchstack/api-interfaces`: `{ data, message, success }`. Errors use the `ApiError` shape (`code`, `message`, `details?`) produced by `ApiException`.
- Async work returns **202** with `{ jobId }` (e.g. brief generation, collaborator sync).
- Example requests live in Requestly collections at the repo root: `requestly/apis/<Collection>/<Request>/` (collections: App, Auth, Briefs, Github, Internal, Invites, Organizations, Slack). Protected requests keep Bearer auth via `__auth.json`.

## Environment Variables

See `.env.example` for the full template.

**Required:**

- `DATABASE_URL` — PostgreSQL connection string (default port 11753 via Docker)
- `BETTER_AUTH_SECRET` — Auth signing secret (`openssl rand -base64 32`); also derives the token-encryption key and signs integration state tokens
- `BETTER_AUTH_URL` — Backend base URL (e.g., `http://localhost:3000`)
- `FRONTEND_URL` — Frontend origin for trusted origins
- `RESEND_API_KEY`, `EMAIL_FROM` — Email sending

**Process timezone:** `TZ` (defaulted to `UTC` by `process.env.TZ ??= 'UTC'` as the first statement of both `src/main.ts` and `src/worker.ts`). The `auth` schema stores naive `timestamp` columns on purpose (Better Auth owns them — see the comment at `migrations/00001_init.ts:39-41`), and those round-trip consistently only while every process shares one zone; the API and the worker both boot `AppAuthModule`, so a deploy where their `TZ` differs shifts session and OTP expiry. Application logic no longer *depends* on the pin — `CadenceService` is process-zone independent by construction — so treat it as the safety net for the naive columns, not as the reason the rest is correct.

**Temporal:** `TEMPORAL_ADDRESS` (default `localhost:7233`), `TEMPORAL_NAMESPACE` (default `default`), `TEMPORAL_TASK_QUEUE` (default `launchstack`), `TEMPORAL_MANAGE_SCHEDULES` (default `true`; the API process manages the `briefs-dispatch-due` and `github-sweep-daily` Schedules, `src/worker.ts` forces this `false`), `INTERNAL_API_TOKEN` (noop endpoint).

**GitHub App** (omit to run with a stub that rejects `GITHUB_APP_NOT_CONFIGURED`): `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

**OpenAI** (required for commit analysis + briefs): `OPENAI_API_KEY` (shared), `OPENAI_COMMIT_ANALYSIS_MODEL`, `OPENAI_BRIEF_MODEL` (both default `gpt-4o-mini`).

**Briefs tuning:** `BRIEFS_DISPATCHER_INTERVAL_SECONDS` (60), `BRIEFS_MAX_PROMPT_CHARS` (30000), `BRIEFS_BACKFILL_MAX_BRIEFS` (100 — a backstop; the binding limit is the 90-day `MAX_HISTORY_DAYS` clamp), `BRIEFS_DISPATCH_BATCH_SIZE` (100), `BRIEFS_PENDING_REAP_MINUTES` (15), `BRIEFS_MAX_SCHEDULES_PER_ORG` (20).

**Slack** (optional — omit any to disable): `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, `SLACK_SCOPES`.

**Google OAuth** (optional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

**Logging:** `LOG_LEVEL` (info), `LOG_FILE_PATH` (`../../logs/app.log`), `LOG_FILE_MAX_SIZE` (50M), `LOG_FILE_KEEP_FILES` (7).
