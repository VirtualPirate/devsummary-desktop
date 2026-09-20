# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commits

Never take credit for a commit. No `Co-Authored-By` trailer for the agent, no "generated with" footer, no self-attribution anywhere in the message or PR body. Commits are authored by the human.

## Project Overview

`devsummary-desktop` is a single-user Electron port of **DevSummary**, ported from the `launchstack` multi-tenant cloud monorepo (NestJS + Postgres + Temporal + React SPA). All data lives locally (PGlite instead of hosted Postgres, an in-process job runner instead of Temporal, pasted credentials instead of OAuth installs). See `docs/MIGRATION-PLAN.md` for the full target architecture, the decisions behind it, and the phase-by-phase execution plan, and `docs/DELTAS.md` for approved deviations from that plan. `docs/receipts/PHASE-*.md` record what each phase actually did.

The product spec below (user flows, AI usage, module table, database schema) describes DevSummary's behavior and carries over to the desktop app unchanged except where a migration phase's receipt says otherwise.

## Product Spec: DevSummary

DevSummary is an AI-powered engineering activity reporter. It connects to a GitHub organization, ingests commit activity, and generates plain-English briefs aimed at non-technical stakeholders (founders, PMs, executives). Briefs are scoped to a project, team, collaborator, or repository, generated on a recurring schedule or on demand, and delivered to Slack and/or as a desktop
notification. **Email delivery is not available in the desktop version** (`docs/DELTAS.md` D-H) —
there is no SMTP setting and no email recipient field on any screen.

### Core User Flows

1. **Connect GitHub** — The user pastes a fine-grained personal access token (`POST /api/integrations/github/token`; Contents + Metadata, read-only). Electron has no public callback URL, so there is no App install and no OAuth. Repositories are reconciled on connect, but ingest nothing yet: a repository is read only on the branch it is *tracked* on (`github.repository_branches`), and a fresh one tracks none. The token is encrypted at rest (AES-256-GCM).
2. **Choose a branch** — Connecting leads to `/integrations/github/setup`, which lists every repository with no branch, pre-selects its GitHub default, and takes a history window (30/90 days). **One repository reads one branch.** Pressing Start writes that choice and is what begins commit ingestion + AI analysis — nothing is fetched or spent on the LLM provider before that. After that first read, new commits arrive from a **sweep** that runs on launch and every 15 minutes, fetching only what is not already stored on that branch; there are no webhooks, because a desktop machine has no public URL to deliver them to. **The choice is write-once**: a repository that already has a branch is frozen (no swapping, no second branch) until changing it is designed, so it never reappears in setup and the API answers 409. Repositories left unconfigured stay inert and are surfaced by a banner on the integrations page.
3. **Organize** — Users create **projects** (groupings of repositories) and **teams** (groupings of GitHub collaborators) to scope briefs.
4. **Schedule** — Users create a **brief schedule**: scope (project/team/collaborator/repo, optionally narrowed to one branch for a repository scope) + cadence (daily/weekly/monthly at a time in a timezone) + a delivery channel (a Slack channel; email is not available, see D-H). Schedules can be paused/resumed; creating one backfills up to 366 days of historical briefs.
5. **Generate** — On schedule (an in-process scheduler enqueues a dispatch job every ~60s, which claims due schedules) or on demand, the backend gathers commits in the period, uses per-commit AI analyses, builds a prompt, and calls the configured LLM provider to produce a non-technical title + summary.
6. **Deliver** — Briefs are sent to Slack (a pasted bot token) and/or as a desktop notification. At least one channel succeeding marks the brief `delivered`; per-channel failures accumulate on `failureReason`. There is no email channel (D-H).
7. **Verify an email (optional)** — Settings → Email takes an address, `POST /api/local-settings/verification` asks `api.devsummary.com` to mail a magic link, and `GET` on the same path polls every 4s until that address is marked verified. There is no account, no session and no key, and **nothing in the app is gated on the result** — no repository limit, no feature flag; the status is recorded in `local_settings` for whatever is gated on it later. The app never sees the token and never opens the landing page. Contract: `docs/desktop-email-verification.md`.
8. **View** — A dashboard lists briefs with filters (scope type, date range, collaborator, exclude no-activity periods) and pagination. A brief detail view shows the summary, a commit-type distribution bar, and links to a granular per-brief commit list.

### AI / LLM Usage

- **Provider** (`src/common/llm/`): OpenAI, Gemini and the four agent CLIs (Claude Code, OpenCode, Cursor, Codex) are served by subclasses of one abstract `LlmClient`, which is also the DI token — callers never learn which one answered. The AI settings page writes `LLM_PROVIDER`, and the client re-resolves it on every call, so switching provider, pasting a key or installing a CLI needs no restart. Gemini is reached through its OpenAI-compatible endpoint, so those two share one SDK and one call shape. **An agent CLI is not an API key**: it spawns the `claude`, `opencode`, `agent` or `codex` binary already installed and logged in on the machine, with the prompt on stdin — Claude Code takes its schema and system prompt on argv, OpenCode takes both through an env var, Cursor takes both in stdin while `--mode ask` locks tools read-only, and Codex takes its schema as a file and its system prompt as a config override while `-s read-only` plus a stripped child environment is its boundary — see the backend AGENTS.md for the adapter seam and detection rules.
- **Commit analysis** (`src/integrations/github/commit-analysis/`): each non-merge commit's message + diff (up to 60k chars) is classified by the configured provider (`gpt-4o-mini` / `gemini-3.1-flash-lite` / `haiku` / `openai/gpt-5.6-luna` / `composer-2.5-fast` / `gpt-5.6-luna` by default, `OPENAI_COMMIT_ANALYSIS_MODEL` / `GEMINI_COMMIT_ANALYSIS_MODEL` / `CLAUDE_CODE_COMMIT_ANALYSIS_MODEL` / `OPENCODE_COMMIT_ANALYSIS_MODEL` / `CURSOR_COMMIT_ANALYSIS_MODEL` / `CODEX_COMMIT_ANALYSIS_MODEL`) into a structured result: `commit_type` (one of `fix`, `feature`, `optimization`, `refactor`, `docs`, `test`, `chore`), summary, and changes list. Analyses are cached per commit.
- **Brief generation** (`src/briefs/generation/`): scope label, date range, and per-commit analyses are assembled into a prompt (~30k char cap) and sent to the configured provider (`gpt-4o-mini` / `gemini-3.1-flash-lite` / `sonnet` / `openai/gpt-5.6-terra` / `composer-2.5` / `gpt-5.6-terra` by default, `OPENAI_BRIEF_MODEL` / `GEMINI_BRIEF_MODEL` / `CLAUDE_CODE_BRIEF_MODEL` / `OPENCODE_BRIEF_MODEL` / `CURSOR_BRIEF_MODEL` / `CODEX_BRIEF_MODEL`) with structured output (Zod) returning `{ title, summary }`. The system prompt mandates jargon-free, achievement/impact-oriented writing for executives.
- **Assistant** (`src/agents/`): a conversational agent over this workspace's own data — repositories, collaborators, commits, projects, teams and activity stats, and nothing outside them. It runs on whichever provider is configured, all six: the keyed providers drive LangChain's OpenAI client, the four agent CLIs go through the same `LlmClient` seam every other AI call uses. Its model is the third override next to commit analysis and brief writing (`gpt-4o` / `gemini-3.6-flash` / `sonnet` / `openai/gpt-5.6-terra` / `composer-2.5` / `gpt-5.6-terra` by default, `OPENAI_AGENT_MODEL` / `GEMINI_AGENT_MODEL` / `CLAUDE_CODE_AGENT_MODEL` / `OPENCODE_AGENT_MODEL` / `CURSOR_AGENT_MODEL` / `CODEX_AGENT_MODEL`) — it picks tools in a loop, so a stronger model than the brief writer's is the usual choice.
- Prompt/completion token counts are stored on every brief and commit analysis for cost tracking.

### Backend Modules (DevSummary)

| Module | Path | Purpose |
|--------|------|---------|
| Brief generation | `src/briefs/generation/` | Generate briefs; list/get briefs and their commits (`/api/organizations/current/briefs*`) |
| Brief delivery | `src/briefs/delivery/` | Slack + desktop-notification delivery (internal, invoked by job handlers) |
| Schedules | `src/briefs/schedules/` | CRUD + pause/resume for recurring brief configs; `CadenceService` computes `nextRunAt` in the user's timezone |
| Projects | `src/briefs/projects/` | Repo groupings (org-scoped, soft-deleted) |
| Teams | `src/briefs/teams/` | Collaborator groupings (org-scoped, soft-deleted) |
| GitHub integration | `src/integrations/github/` | PAT connect + validate, repo reconcile, branch tracking, repo/commit sync (a periodic sweep drives ongoing ingestion — there are no webhooks) |
| Commit analysis | `src/integrations/github/commit-analysis/` | AI classification of commits |
| LLM provider | `src/common/llm/` | Abstract `LlmClient` + one subclass per provider (OpenAI, Gemini, unconfigured) and the live per-call resolver |
| Slack integration | `src/integrations/slack/` | Bot-token paste + message posting |
| Jobs | `src/jobs/` | A `jobs` table plus an in-process poll loop (replaces Temporal): brief dispatch/generation/backfill, GitHub commit ingestion + analysis, collaborator sync, LOC-stats backfill (see backend AGENTS.md for the full job catalog) |
| Agents | `src/agents/` | The `/agents` chat: threads, seven read-only tools over local data, and an in-process LangGraph run checkpointed to the `agents` schema (`/api/agents/threads*`) |
| Local settings | `src/local/` | Seeded identity, the per-boot API token guard, the credential bundle, and the settings API |

All DevSummary endpoints are workspace-scoped via the global `OrgContextGuard` with role checks (`RequireOrgRole('admin'|'member')`); the guard falls back to the seeded default workspace when the `x-organization-id` header is absent. Every request outside `/api/health*` must also carry the per-boot `x-desktop-token`.

### Database (DevSummary schemas)

- **`briefs` schema**: `briefs` (generated summaries, status, token usage, delivery metadata), `brief_commits` (brief ↔ commit junction for drill-down), `brief_schedules`, `projects` + `project_repositories`, `teams` + `team_collaborators`.
- **`github` schema**: `installations`, `repositories`, `repository_branches` (the branch a repository is read on — one row per repository today, write-once; no live row = repo is inert), `commits` (incl. raw diff data), `commit_branches` (which branches a commit was seen on — many per commit, since branches share ancestry), `commit_analyses`, `collaborators`, `repository_collaborators`, `webhook_events` (dead — no webhook receiver; the migration is shipped and never edited).

### Frontend Screens (DevSummary)

Components live in `src/components/devsummary/`. Routes:

- `/briefs` — dashboard with filters and pagination; `/briefs/$briefId` — detail with commit-type bar (`commit-type-bar.tsx`) and retry-on-failure; `/briefs/$briefId/commits` — granular commit list with analysis details and GitHub links
- `/commits` — org-wide commits explorer: date range, type and repository filters, an "Analyzed only" toggle (on by default) and 50-per-page keyset pagination. No sidebar entry; it is reached from the home activity cards, the briefs list header and a brief's own commit list, each carrying a `back` path
- `/schedules`, `/schedules/new`, `/schedules/$scheduleId` — schedule management (scope picker, cadence, delivery channels)
- `/projects`, `/projects/$projectId` and `/teams`, `/teams/$teamId` — grouping management
- `/integrations/github` — PAT connect form, connected account + repositories with their branch; banners a count of repositories that have no branch and therefore read nothing
- `/agents` — the assistant: thread rail plus conversation (`components/devsummary/agents/`, over the vendored `components/assistant-ui/`). Full-bleed — the conversation owns the scroll — and always in the sidebar, since an unconfigured provider is a run-time error with a message, not a hidden menu item
- `/settings` — local settings: desktop notifications, theme, data directory, workspace and links to the integrations pages (GitHub PAT, AI provider + its key + model overrides + token totals, Slack bot token). No SMTP card — email delivery is not available (D-H)
- `/integrations/github/setup` — post-connect branch selection (`integrations-github-setup.tsx` + `components/integrations/branch-setup-list.tsx`, `branch-picker.tsx`, `history-window-picker.tsx`); admin-only, re-enterable, and the only place ingestion is started

Briefs covering periods with zero commits get a distinct "no activity" badge/treatment.

## Commands

### Development
```bash
pnpm dev                    # Build packages AND backend, then run frontend (Vite :5173) + Electron desktop shell in parallel
pnpm dev:frontend           # Frontend only
pnpm dev:desktop            # Electron desktop shell only (forks the backend as a utility process)
pnpm build:backend          # Compile the backend to dist/ — what the shell actually runs
```

> **The shell runs compiled backend code, not your source.** `apps/desktop/src/main.ts` forks
> `apps/backend/dist/main.js`, so **editing `apps/backend/src` changes nothing in the running app until
> the backend is rebuilt** — and there is no backend watcher in the dev loop. `pnpm dev` now runs
> `build:backend` for exactly this reason; it used to build only the shared packages, which meant a
> stale `dist/` could silently serve old behaviour through several rounds of "the fix didn't work".
> After a backend edit mid-session, run `pnpm build:backend` and restart the shell. Verify rather than
> assume — `grep` the symbol you changed in `apps/backend/dist/`, or check `dist/main.js`'s mtime.
> Note that `pnpm --filter backend start:dev` does *not* help here: it runs its own Nest server from
> source on a different port, and the shell keeps forking `dist/`.

### Build
```bash
pnpm build                  # Build packages, backend, frontend, then desktop
pnpm build:packages         # Build shared packages only
pnpm dist                   # Build everything, then package the desktop app (electron-builder)
```

### Database (local PGlite file, no Docker)
```bash
pnpm db:generate            # Create a new (blank) Kysely migration file
pnpm db:up                  # Apply migrations
pnpm db:down                # Rollback last migration
pnpm db:status              # List migrations and their status
```

### Testing (backend)
```bash
cd apps/backend
pnpm test                   # Run unit tests (Jest)
pnpm test:watch             # Watch mode
pnpm test:e2e               # E2E tests (Vitest + in-memory PGlite; no Docker, no network)
pnpm exec jest --testPathPatterns=<pattern>  # Run a single test file
```

### Linting
```bash
pnpm lint                   # Lint all workspaces
```

## Desktop architecture

This repo is being ported phase by phase per `docs/MIGRATION-PLAN.md` — read §0–§4 there before touching anything, plus `docs/DELTAS.md` for approved deviations (workspaces kept, auto-login single user, no Google OAuth, packaging deliverable scoped to dev-runnable, mocked-externals E2E, the 14-migration count, and the commit-per-phase-boundary rule). `docs/receipts/PHASE-*.md` are the append-only record of what each phase actually did, including deviations and out-of-scope defects found along the way. Do not relitigate a decision in the plan's §3 table without evidence from the Phase 0 spike (`docs/receipts/PHASE-0.md`).

## Timezones

Read this before writing anything that touches a date. Every rule below is here because the bug it prevents has already shipped once — see `docs/timezone-audit.md` for the findings and their fixes.

The model: **an instant and a calendar date are different types.** A `timestamptz` column, a JS `Date`, and an ISO string with an offset are instants. A brief's period, a chart bucket, and anything a user picks in a date input are calendar dates in some specific zone. Converting between them requires naming the zone, and there are exactly three legitimate zones to name — the schedule's (for a brief's period), the viewer's (for something the viewer themselves just picked), and UTC (for a calendar date that is already resolved and only needs printing). Anything else is a bug.

1. **Never build a wall clock with `new Date(y, m, d, h, …)`.** That constructor resolves in the *server's* zone, and V8 silently rewrites the fields when they land in that zone's DST gap. Resolve a zoned wall clock through a string (`` `${dateKey}T${time}` `` + an explicit zone) or through `CadenceService`'s primitives, never through a fabricated local `Date`.
2. **Do calendar arithmetic on `YYYY-MM-DD` keys, not on instants.** A local day is 23, 24 or 25 hours, so `+ 86400000` skips or repeats a day twice a year. `apps/backend/src/analytics/lib/activity-buckets.ts` is the reference: parse to `{y, m, d}`, step with UTC-field `Date`s used purely as containers.
3. **A `YYYY-MM-DD` key is already resolved — never convert it into a zone.** To print one, anchor `T00:00:00Z` and format with `timeZone: "UTC"`. Anchoring at noon (`T12:00:00Z`) to "be safe" is off by one for every zone at +12 or beyond.
4. **Periods and windows are half-open — `start <= t < end`.** An inclusive `23:59:59.999` end does not tile: on a 25-hour fall-back day the repeated hour falls between one window's end and the next window's start and belongs to neither. Derive the exclusive end from the *next calendar date's* midnight, never by adding 24h or 1ms. Consequences to keep straight: a label must format `end - 1ms` to name the last day covered, and a filter comparing against a stored end wants `> from` / `<= to`, since a period covering the previous day ends at exactly `from`.
5. **Tiling is not the test — "a window is exactly the set of instants whose local date is that day" is.** Windows can tile perfectly with zero gaps and still be shifted an hour off, filing commits under the wrong day; that is what a nonexistent local midnight did in five zones, and a gap-free tiling proof passed the whole time. When a wall clock does not exist, resolve to the transition instant itself (the first instant that *exists* at or after it) — neither candidate offset gives you that, and rounding up to the next whole hour overshoots in the zones with 30- and 45-minute shifts. Resolve it in **one** place: two callers with two answers is how a report came to disagree with its own brief.
6. **A stored period's zone belongs on the row, not on the config it came from.** Schedule timezones are editable, so reading a live schedule to render an old brief re-tiles history. `briefs.briefs.period_timezone` is the snapshot; use it.
7. **Never send a zone *name* to Postgres.** Resolve the boundaries in app code and pass instants. `AT TIME ZONE` rejects legacy aliases (`Asia/Calcutta`) on a Postgres without `tzdata-legacy`, and silently inverts the sign of offset strings (`+05:30`). Where a zone name must reach SQL (the analytics bucket query), it goes through `normalizeIanaTimeZone` as a bound parameter and the caller handles SQLSTATE `22023`.
8. **Validate a timezone as an IANA id, not as "something `Intl` accepts".** `Intl` accepts `'+05:30'`. Check `Intl.supportedValuesOf('timeZone')` membership, allowing the legacy aliases in `timezone-aliases.ts`.
9. **Test on a transition date under a non-UTC process zone**, or the test proves nothing — the whole suite passes under `TZ=America/Santiago` while the bug is live, because no test sits on a transition. Use `apps/backend/test/timezone-jest-environment.js` (per-file docblock; setting `process.env.TZ` inside a spec is a no-op under Jest 30). Zones worth reaching for: `America/New_York` (gap at 02:00), `America/Santiago` (gap at 00:00), `Asia/Kathmandu` (+05:45), `Pacific/Chatham` (+12:45).
