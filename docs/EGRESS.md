# Network egress

Every host DevSummary can open a connection to, what goes over it, and what turns it
off. Written 2026-09-15 against branch `feat/agent-cli-provider`; the evidence column
says where in this repo the connection is made, so this file can be re-derived rather
than trusted.

An install that has connected nothing talks to nothing. Every row below is switched on
by a credential the user pastes or a CLI they select — there is no baseline connection,
no update check and no crash reporter.

## Always, once GitHub is connected

| Host | Port | What is sent | What comes back | Evidence |
|---|---|---|---|---|
| `api.github.com` | 443 | The fine-grained PAT as a bearer token; repository, branch and commit queries | Repository metadata, branch lists, commit messages, diffs, collaborator logins and avatar URLs | `integrations/github/github.client.ts` (Octokit, default base URL) |
| `avatars.githubusercontent.com` | 443 | Nothing but the request for an image URL GitHub supplied | Collaborator avatars, rendered by the renderer | `components/devsummary/new-team/collaborator-picker.tsx:120`, `schedules/scope-picker.tsx:184`, `routes/team-detail.tsx:179` |

Frequency: a sweep on launch and every ~15 minutes, fetching only commits not already
stored on a tracked branch. A repository with no tracked branch is read never.

## The AI provider — exactly one of these, chosen on the AI settings page

The same payload in every case: one commit's message plus its diff (capped at 60k chars)
for classification, and an assembled prompt of scope label, date range and per-commit
analyses (capped at ~30k chars) for a brief.

| Provider | Host | Reached by | Evidence |
|---|---|---|---|
| OpenAI | `api.openai.com` | The `openai` SDK with the user's own key | `common/llm/llm-config.ts:141` (no `baseURL` override) |
| Google Gemini | `generativelanguage.googleapis.com` | The same SDK against Gemini's OpenAI-compatible endpoint | `common/llm/llm-config.ts:23` |
| Claude Code | Anthropic's API, as the local `claude` binary's own login | Spawned subprocess — DevSummary opens no socket | `common/llm/agents/claude-code.adapter.ts` |
| OpenCode | Whichever provider `opencode auth login` connected — OpenAI for the default `openai/gpt-5.6-luna`. **Not** OpenCode Zen: `opencode/*` ids answer 403 outside the opencode TUI | Spawned subprocess | `common/llm/agents/opencode.adapter.ts` |
| Cursor | Cursor's own backend, as the account `agent login` authenticated | Spawned subprocess | `common/llm/agents/cursor.adapter.ts` |
| Codex | OpenAI, as the local `codex` binary's own login | Spawned subprocess | `common/llm/agents/codex.adapter.ts` |

**The four CLI rows are not DevSummary's connections.** The prompt goes to a child process
over stdin; where that process sends it is decided by the binary and the login the user
already has. An enterprise allow-list has to cover the CLI's own destination, which is the
same one the developer's terminal already uses. Those binaries also make their own update
and telemetry requests on their own schedule: DevSummary suppresses OpenCode's
(`OPENCODE_DISABLE_AUTOUPDATE=1`) and can suppress no others.

The child's environment is the backend's minus the credential bundle — the PAT, the
provider key, `DB_ENCRYPTION_KEY` and the Slack bot token are stripped before the spawn
(`common/llm/agents/run-cli.ts`), so none of them can be read by a model whose prompt is
an untrusted diff.

## Delivery — only for channels the user configures

| Host | Port | What is sent | Evidence |
|---|---|---|---|
| `slack.com` | 443 | Bot token, channel id, brief title and summary | `integrations/slack/slack.client.ts` (`@slack/web-api`, `chat.postMessage`) |

Slack is the **only** delivery destination. Email delivery is not available in the desktop
version (`docs/DELTAS.md` D-H), so no mail relay is ever contacted. Desktop notifications are
the second delivery channel and are local only.

## Telemetry

One anonymous record per launch: a random install id minted at consent, app version, OS
platform and version, and the launch timestamp. No repository names, no commit data, no
credentials.

**Off in every build today.** The destination is `TELEMETRY_URL`, which defaults to the
empty string, and an empty value makes no request at all — the consent dialog describes a
transmission that does not yet happen, deliberately, rather than the other way round
(`apps/desktop/src/main.ts`).

## Opened in the system browser, not by the app

`shell.openExternal` hands these to the default browser; DevSummary makes no request and
sees no response. Commit and repository links on `github.com`, and the PAT creation page
(`github.com/settings/personal-access-tokens/new`). Only `http:`/`https:` is accepted, in the
main process (`apps/desktop/src/main.ts`) and again in the renderer's link handler.

The consent dialog's terms and privacy links used to be here, pointing at a marketing domain
that never resolved. They open nothing now: `LICENSE` and `PRIVACY.md` are imported into the renderer bundle at
build time and rendered in a dialog (`components/consent/legal-dialog.tsx`), so reading the
terms opens no connection and depends on no website.

## What is not here

- **No update check.** `publish: null`, no `electron-updater`. A new version reaches a user
  the way the first one did.
- **No crash reporter.** Deliberate; see `docs/RELEASE-CHECKLIST.md` §5.
- **Nothing bound off loopback.** The backend listens on `127.0.0.1` with an OS-assigned
  port and a per-boot bearer token; the renderer's CSP allows `connect-src` to that host
  and nothing else (`apps/frontend/vite.config.ts`).
