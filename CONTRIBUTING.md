# Contributing

Thanks for wanting to work on DevSummary Desktop. This file covers what an outside contributor
needs: how to get it running, what to read before you write code, what to run before you open a PR,
and the handful of things that are settled and will be declined.

## License, before anything else

DevSummary is **open source** — [MIT](LICENSE). You may run, read, change, share and sell it,
including at work on your employer's repositories, as long as the copyright notice and the license
text travel with any copy you distribute.

By opening a pull request you agree that your contribution is licensed to the project under those
same terms, and that you have the right to submit it (your own work, or work you are authorized to
contribute).

## Prerequisites

- **Node ≥ 22.12** (`engines` in the root `package.json`)
- **pnpm 10** (`pnpm 10.33` is what the lockfile was written with)
- macOS or Linux. Windows has never been launched — the agent-CLI providers report themselves absent
  there on purpose, and packaging for it is untested. Patches welcome, but you are the first one to
  run it.

No Docker, no Postgres server, no cloud account. The database is a PGlite directory on your disk.

## Getting it running

```bash
pnpm install
pnpm dev
```

That builds the shared packages **and the backend**, starts Vite on :5173, and opens the Electron
window. First boot creates the database, applies the migrations and seeds one local user plus a
default workspace. There is no sign-in.

The app is usable with no credentials at all — you only need a GitHub PAT and an LLM provider to
exercise ingestion and brief generation. See [README.md](README.md#connecting-things) for how to
get each one, and `docs/EGRESS.md` for every host the app can reach.

### The one gotcha that costs everyone an hour

**The Electron shell runs `apps/backend/dist/main.js`, not your source, and there is no backend
watcher.** After editing `apps/backend/src`, run `pnpm build:backend` and restart the shell, or your
change is simply not in the running app. `pnpm --filter backend start:dev` does not help: it runs a
separate server from source on a different port while the shell keeps forking `dist/`.

The frontend hot-reloads normally.

## Layout

```
apps/desktop/    Electron main + preload: secrets, port handoff, notifications, tray
apps/backend/    NestJS + Kysely over PGlite + the in-process job runner
apps/frontend/   React 19 + Vite + Tailwind v4 + TanStack Router/Query
packages/        Shared types/schemas (api-interfaces) and small utilities (core)
docs/            EGRESS, DELTAS (approved deviations), release checklist, receipts
```

## Read these before you write code

The repository's design decisions are written down, and most of them exist because the bug they
prevent already shipped once. Skimming saves you a review round:

- **[AGENTS.md](AGENTS.md)** (root) — product spec, the full command list, and the **Timezones**
  section. Read Timezones before touching anything that handles a date. All nine rules are
  load-bearing.
- **[apps/backend/AGENTS.md](apps/backend/AGENTS.md)** — module graph, the jobs table and its
  handlers, the LLM provider seam, the briefs pipeline, the GitHub integration.
- **[apps/frontend/AGENTS.md](apps/frontend/AGENTS.md)** — routing, API hooks, component layout.
- **[docs/DELTAS.md](docs/DELTAS.md)** — deliberate deviations from the migration plan. If something
  looks missing, check here first; it may be missing on purpose.

They are written for coding agents, but they are the real architecture notes and apply to humans
identically.

## Tests

There is **no CI**. Nothing runs these for you — run them yourself before opening a PR.

```bash
pnpm lint                          # every workspace
pnpm test                          # backend unit tests (Jest)
pnpm --filter backend test:e2e     # full pipeline over in-memory PGlite; no Docker, no network
pnpm --filter desktop test:bundle  # packaged bundle stays asar-packed
pnpm --filter desktop test:csp     # renderer CSP and navigation locks
pnpm build                         # packages → backend → frontend → desktop, i.e. every tsc
```

A single backend test file:

```bash
cd apps/backend
pnpm exec jest --testPathPatterns=<pattern>
pnpm exec vitest run --config vitest.e2e.config.ts <path>
```

There is no frontend test setup; frontend changes are covered by `pnpm build` (strict tsc) and by
running the app.

Some checks cannot be automated because they need credentials or a built artifact — a real GitHub
PAT, an installed dmg, each agent CLI at the LLM boundary. Those are documented in
`apps/desktop/test/README.md` and `apps/backend/test/agent-cli/README.md`. Say in the PR which of
them you ran.

### If you add a test that touches dates

Pin the *process* timezone with the custom Jest environment
(`apps/backend/test/timezone-jest-environment.js`, selected per file by docblock). Setting
`process.env.TZ` inside a spec is a silent no-op under Jest 30, and a test that does not sit on a
DST transition proves nothing — the whole suite passed while the cadence bug was live.

## Pull requests

- **Branch off `main`.** Keep one PR to one concern.
- **Conventional commits**, matching the existing log: `feat(scope): …`, `fix(scope): …`,
  `docs(scope): …`, `chore(scope): …`. The subject says what changed, in the imperative.
- **Explain the why in the PR body**, especially for a fix — what the wrong behavior was, and what
  makes the new behavior right. A failing test that now passes is the best version of this.
- **Update the AGENTS.md that owns the area** when you change how something works. Those files are
  the spec, not a summary of it; a change that contradicts them and leaves them standing is
  incomplete.
- **Never edit a shipped migration.** `apps/backend/src/migrations/00001–00014` are copied verbatim from
  the cloud original, and everything already applied on a user's machine is frozen. Add a new
  migration, and add it to `src/databases/kysely/migrations-index.ts` — the boot path uses a static
  array, not a directory listing.
- **New dependencies need a reason in the PR.** This app ships to end users and every addition lands
  in `THIRD-PARTY-NOTICES.md` and in the installer. A few lines beat a package.

## Settled decisions

These come up regularly and are decided. Open an issue to argue the decision — don't open a PR
implementing the reversal.

- **No email delivery.** No SMTP config, no recipients, no "deliver by email" anywhere
  (`docs/DELTAS.md` D-H), and neither is Slack delivery (see the root `AGENTS.md`). A desktop
  notification is the one channel.
- **No webhooks.** A desktop machine has no public URL; ingestion is the 15-minute sweep.
- **No OAuth.** Credentials are pasted tokens, for the same reason.
- **No date library in `CadenceService`.** Both candidates were measured against it and both lose on
  correctness; the reasoning is in `apps/backend/AGENTS.md`.
- **No sign-in.** One user, one machine.

## Reporting bugs

Open an issue with: what you did, what happened, what you expected, your OS, and whether it was
`pnpm dev` or an installed build (they do not share data).

Logs are the most useful attachment. They live in `<userData>/logs/app.log.<n>` — the highest number
is the live one, and the Settings screen prints the exact directory and can reveal it in your file
manager. Request bodies are never logged and credential headers are redacted, but **read a log
before you paste it** and redact anything personal: repository names, commit messages and branch
names all appear.

**Do not report a security issue in a public issue.** Use GitHub's private vulnerability reporting
on this repository instead, and include the version and a minimal reproduction.
