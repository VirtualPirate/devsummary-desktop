# Changelog

Notable changes per release. Dates are the tag date. Versions follow
[semantic versioning](https://semver.org); until 1.0.0 the minor is the breaking one.

## 0.1.0 — unreleased

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

### Known limits in this version

- **Windows has never been launched.** Every target builds, and the mac dmgs (arm64 and x64
  under Rosetta) and both AppImages have been launched; the nsis installer has not. Agent-CLI
  providers report themselves unavailable on Windows rather than guessing at a spawn path that
  has never run there.
- **Ad-hoc signed, not notarized.** A downloaded dmg is refused by Gatekeeper; a copy built or
  moved locally opens.
- **No auto-update and no in-app update check.** No crash reporter and no telemetry, by
  choice — `logs/app.log` in the data directory is what a bug report attaches, and the settings
  screen has a button that reveals it.
- **No email delivery.** Slack and desktop notifications only.
- **OpenCode Zen is not usable** as an AI backend: `opencode/*` models answer HTTP 403 outside
  the opencode TUI, so OpenCode runs on whichever provider `opencode auth login` connected.

### Legal

Source-available under **PolyForm Shield 1.0.0** — free to use and modify, including at work;
the one prohibited purpose is building a competing product. `LICENSE` doubles as the terms the
app asks you to accept, `PRIVACY.md` is the privacy policy, and `THIRD-PARTY-NOTICES.md`
attributes 550 components. All three ship inside the binary; none of them needs a website.
