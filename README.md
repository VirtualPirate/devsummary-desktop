# DevSummary Desktop

An AI-powered engineering activity reporter that runs entirely on your machine.

It connects to GitHub with a personal access token, ingests commit activity from the branches you
choose, classifies each commit with an LLM, and writes plain-English briefs for people who do not
read diffs — founders, PMs, stakeholders. Briefs are scoped to a project, a team, a collaborator or
a repository, generated on a schedule or on demand, and delivered to Slack or as a desktop
notification. **Email delivery is not available in the desktop version** — see
[Not in the desktop version](#not-in-the-desktop-version).

It is a single-user Electron port of a multi-tenant cloud app. Nothing is hosted: the database is a
directory on your disk, background work runs in-process, and every credential is your own.

**Stack.** Electron shell → NestJS backend on loopback → React 19 + Vite renderer.
[PGlite](https://pglite.dev/) (Postgres compiled to WASM) instead of a Postgres server, a `jobs`
table plus a poll loop instead of Temporal, pasted credentials instead of OAuth installs.

## Getting started

Node ≥ 22.12 and pnpm.

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds the shared packages, starts Vite on :5173, and opens the Electron window. First
boot creates the database, applies the migrations and seeds one local user and a default workspace
("My Workspace"); the app opens straight on the dashboard. There is no sign-in and never will be.

Other commands:

```bash
pnpm build                    # packages → backend → frontend → desktop
pnpm dist                     # build, then package with electron-builder (see caveat below)
pnpm lint                     # every workspace
pnpm --filter backend test    # unit tests (Jest)
pnpm --filter backend test:e2e  # end-to-end (Vitest + in-memory PGlite; no Docker, no network)
```

## Where your data lives

Everything is under Electron's `userData` directory, named after the app — on macOS that is
`~/Library/Application Support/<app>`, on Windows `%APPDATA%\<app>`, on Linux `~/.config/<app>`.
`<app>` is `DevSummary` in a packaged build and `desktop` under `pnpm dev`, so **a dev run and an
installed build do not share data**. The settings screen shows the exact path in use.

| What | Where |
|---|---|
| Database | `<userData>/data/` — a PGlite directory |
| Credentials | `<userData>/secrets.bin` — encrypted with Electron `safeStorage`, i.e. the OS keychain |
| Logs | `<repo-root>/logs/app.log` in dev; `LOG_FILE_PATH` otherwise |

Nothing is sent anywhere except to GitHub, OpenAI and Slack — each only when you have given it a
credential. The backend listens on a random loopback port and every request needs a
per-boot token, so other processes on the machine cannot read your data over HTTP either.

A headless `pnpm --filter backend start:dev` uses `./.data` instead, and has no keychain — see
`apps/backend/.env.example`.

## Connecting things

Credentials live on the **Settings** and **Integrations** screens. Nothing is ever read back out of
the app once saved.

**GitHub (required).** Create a [fine-grained PAT](https://github.com/settings/personal-access-tokens/new)
with **Contents: Read-only** and **Metadata: Read-only** on the repositories you want, and paste it.
DevSummary reads through your own access, so a repository you can see is a repository it can see.

Connecting fetches nothing. Go to the branch-setup screen, pick one branch per repository and a
history window (30 or 90 days), and press Start — that is what begins ingestion and the first OpenAI
spend. **The choice is write-once**: a repository reads one branch, and changing it is not yet
supported. A repository with no branch stays completely inert.

**OpenAI (required).** Paste an API key. You can override the models
(`gpt-4o-mini` by default for both commit classification and brief writing) on the same screen, and
it shows the running token totals so you can see what you are spending.

**Slack (optional).** Create a Slack app, give the bot `chat:write`, `channels:read`, `groups:read`
and `users:read`, install it to your workspace and paste the `xoxb-` token. Pick the channel per
schedule. Invite the bot to private channels from inside Slack.

**Desktop notifications (optional).** A toggle. With it on, a brief that reaches your machine counts
as delivered even when Slack is unconfigured.

## Not in the desktop version

**Email delivery.** There is no SMTP configuration, no email recipients on a schedule or a
one-off brief, and no "deliver by email" button — on any screen. A brief is delivered to Slack
and/or a desktop notification, and it is always readable in the app itself. This is deliberate and
permanent for the desktop build; the rationale and the exact removal list are `docs/DELTAS.md` D-H.

## Packaging

`pnpm dist` runs electron-builder against the config in `apps/desktop`. **It is an unverified
sketch.** The config exists — targets, `asarUnpack` for PGlite's `.wasm`/`.data` files (which cannot
be read from inside an asar), `userData` as the data directory — but no installer has been built or
run on a clean machine, and there is no code signing, no notarization and no auto-update. Treat the
first real packaging run as work, not as a command. See `docs/DELTAS.md` D-D and
`docs/receipts/PHASE-10.md`.

## Layout

```
apps/
  desktop/    Electron main + preload: secrets, port handoff, notifications, tray
  backend/    NestJS + Kysely over PGlite + the job runner
  frontend/   React 19 + Vite + Tailwind v4 + TanStack Router/Query
packages/
  api-interfaces/  Shared request/response types and Zod schemas
  core/            Small shared utilities
docs/
  MIGRATION-PLAN.md  How this was ported, and why each decision was made
  DELTAS.md          Approved deviations from that plan
  receipts/          What each phase actually did
```

`AGENTS.md` at the root carries the product spec and the **Timezones** rules — read that section
before touching anything that handles a date. `apps/backend/AGENTS.md` and
`apps/frontend/AGENTS.md` cover their own implementations.
