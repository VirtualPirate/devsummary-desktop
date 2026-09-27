# Changelog

Notable changes per release. Dates are the tag date. Versions follow
[semantic versioning](https://semver.org); until 1.0.0 the minor is the breaking one.

## 0.2.0 — 2026-09-27

### Added

- **Assistant** (`/agents`). A chat over this workspace's own data — repositories,
  collaborators, commits, projects, teams and activity stats — through seven read-only tools.
  It runs on whichever provider is configured, the four agent CLIs included, with its own model
  override next to commit analysis and brief writing.
- **Commits explorer** (`/commits`). Every commit in the workspace, filtered by date range,
  type and repository, analysed-only by default, reached from the home activity cards, the
  briefs list and a brief's own commit list.
- **Model picker.** The three model overrides on the AI page list what the provider actually
  offers — a keyed provider's own `/models`, `agent --list-models`, `opencode models`, or a fixed
  set for `claude` and `codex` — and still accept a typed id for a model no list has yet.
- **Email verification, optional.** Settings → Email, and a "Not Verified" tag in the topbar
  until an address is confirmed. Nothing is gated on it. The address is the one thing the app
  sends to `api.devsummary.com`; `PRIVACY.md` and `docs/EGRESS.md` say so.
- **GitHub token guide** beside the PAT form, showing which fine-grained permissions to grant.
- **DevSummary Cloud** card in the sidebar footer, dismissible for the session.

### Changed

- **GitHub connect needs a working AI provider.** Connecting a PAT starts ingest and every
  commit is analysed, so the form shows the set-up-AI panel until a key is pasted or the
  selected agent CLI still runs. On first launch an installed agent CLI is selected
  automatically when no provider has been chosen.
- **Briefs select commits by when they landed** on the tracked branch, not by their git date.
  Work merged today into a closed period used to fall into no brief at all. Briefs written
  before this release keep the clock they were generated on, so they still agree with their
  own commit count.
- Commit rows show the exact date and time instead of a relative label.
- **License: GPL-3.0-or-later.** The `v0.1.0` tag was cut with the MIT text.

### Removed

- **Slack delivery.** The integration page, the bot token, the channel picker on schedules and
  on-demand briefs, the "Deliver to Slack" button and the whole `/api/integrations/slack` surface
  are gone, along with the `@slack/web-api` dependency. A brief is delivered as a desktop
  notification and read in the app. This is deliberate and permanent — see the root `AGENTS.md`.
  The `slack` schema and the Slack columns on `brief_schedules` / `briefs` stay: shipped
  migrations are never edited. Nothing reads or writes them, and a `delivered_channels` row
  written before this release still reads back its `'slack'` entry.

## 0.1.0 — 2026-09-19

First version with a number. Everything before it was `0.0.1` across four `package.json`
files, which said nothing about what was in them.

**Why 0.1.0 and not 1.0.0:** nothing has been distributed, and the app is not yet installable
by a stranger — the dmg is ad-hoc signed, so Gatekeeper refuses a *downloaded* copy.
1.0.0 is for the first build a customer can open.

### The product

DevSummary reads a GitHub organization's commit activity and writes plain-English briefs for
people who do not read diffs. It runs entirely on the machine it is installed on: PGlite for
storage, an in-process job runner, and pasted credentials instead of OAuth.

- **GitHub** — a fine-grained PAT (Contents + Metadata, read-only), encrypted at rest with
  AES-256-GCM. One repository is read on one branch, chosen once; a sweep every 15 minutes
  fetches what is new. No webhooks — a desktop has no public URL to deliver them to.
- **AI providers** — OpenAI, Gemini, and four coding-agent CLIs already installed and logged in
  on the machine (Claude Code, OpenCode, Cursor, Codex), behind one client interface. Commits
  are classified per commit and cached; briefs are generated from those analyses.
- **Briefs** — scoped to a project, team, collaborator or repository, on a daily/weekly/monthly
  schedule in a named timezone, or on demand. Delivered to Slack and/or as a desktop
  notification. Token counts are stored per brief and per analysis.
- **Organize** — projects group repositories, teams group collaborators; both scope a brief.
- **Updates** — the app asks GitHub every six hours whether a newer version exists,
  downloads it in the background, and restarts into it when you click Restart. Off in one
  switch on the Settings page, which is also the only place a failed check is reported. On
  macOS it only tells you: an ad-hoc signature cannot be auto-installed, so the button opens
  the Releases page instead.

### Known limits in this version

- **Windows has never been launched.** Every target builds, and the mac dmgs (arm64 and x64
  under Rosetta) and both AppImages have been launched; the nsis installer has not. Agent-CLI
  providers report themselves unavailable on Windows rather than guessing at a spawn path that
  has never run there.
- **Ad-hoc signed, not notarized.** A downloaded dmg is refused by Gatekeeper; a copy built or
  moved locally opens.
- **No macOS auto-install.** Windows and Linux download and restart in place; macOS only
  reports that a version exists and sends you to the Releases page, because an ad-hoc
  signature cannot be validated by Squirrel.Mac. No crash reporter and no telemetry, by
  choice — `logs/app.log` in the data directory is what a bug report attaches, and the settings
  screen has a button that reveals it.
- **No email delivery.** Slack and desktop notifications only.
- **OpenCode Zen is not usable** as an AI backend: `opencode/*` models answer HTTP 403 outside
  the opencode TUI, so OpenCode runs on whichever provider `opencode auth login` connected.

### Legal

Free software under the **GNU GPL v3.0 or later** — use, modify, fork and sell it; anyone you
distribute it to gets the source under the same license. `LICENSE` doubles as the terms the
app asks you to accept, `PRIVACY.md` is the privacy policy, and `THIRD-PARTY-NOTICES.md`
attributes 550 components. All three ship inside the binary; none of them needs a website.
