# DevSummary Privacy Policy

Effective 17 September 2026. Contact: support@devsummary.com

DevSummary is a desktop application that runs on your computer. There is no DevSummary
account, no DevSummary server holding your data, and nothing to sign up for. This policy
describes the only data that leaves your machine, and it is derived from `docs/EGRESS.md`
in the source repository — a per-connection audit you can re-derive from the code rather
than take on trust.

## What is stored, and where

Everything DevSummary knows about you lives in a database on your own computer, in the
per-user application data directory your operating system provides:

- On macOS: `~/Library/Application Support/DevSummary`
- On Windows: `%APPDATA%\DevSummary`
- On Linux: `~/.config/DevSummary`

That directory holds the repositories, branches, commits, commit analyses, briefs,
teams and schedules you set up, plus `secrets.bin` — your GitHub token, AI provider key
and Slack bot token, encrypted at rest. None of it is uploaded, backed up or
synchronised anywhere by DevSummary.

Deleting the application does **not** delete this directory. To remove your data, delete
the directory above.

## What leaves your machine

An installation that has connected nothing talks to nothing. Every transmission below is
switched on by a credential you paste or a tool you select.

**GitHub** (`api.github.com`) — once you connect a personal access token. DevSummary sends
that token and asks for repositories, branches and commits on the branches you track, and
receives commit messages, diffs and collaborator names. Collaborator avatar images are
loaded from `avatars.githubusercontent.com`. A repository with no tracked branch is never
read.

**Your AI provider** — once you choose one. Analysing a commit sends that commit's message
and its diff; writing a brief sends the resulting analyses. The destination is whichever
provider you selected, and the AI settings page names it at the moment you choose:

- An API key you paste sends to that vendor directly (OpenAI's `api.openai.com`, or
  Google's `generativelanguage.googleapis.com`).
- A coding-agent CLI already installed on your machine (`claude`, `opencode`, `cursor`,
  `codex`) receives the prompt on standard input and sends it onward under **its own**
  login, to whichever service that tool is authenticated with. That connection is the
  tool's, not DevSummary's, and it is governed by that vendor's privacy policy. Those
  tools may also make their own update and telemetry requests, which DevSummary does not
  control.

Your GitHub token, provider key and Slack token are removed from the environment of those
child processes before they start, so a model reading an untrusted diff cannot read them.

**Slack** (`slack.com`) — only if you configure Slack delivery. The bot token, the target
channel and the brief's title and summary are sent. Slack is the only delivery destination
that leaves the machine; desktop notifications are local. There is no email delivery.

**Install telemetry** — one anonymous record: a random install identifier generated when
you accept the terms, the app version, your operating system's platform and version, and
the launch timestamp. No repository names, no commit data, no file contents, no
credentials, no name or email address. This is described in the startup dialog you accept.
In the current build the destination is unset, so no telemetry request is made at all.

## What is never sent to us

Repository names, commit messages, code and diffs, brief contents, teammate names and
email addresses, and your credentials. There is no crash reporter and no update check.
DevSummary does not use advertising, does not profile you, and has nothing to sell to a
third party because it collects nothing to sell.

## Links you click

Commit and repository links, and the GitHub token-creation page, open in your default
browser through your operating system. DevSummary makes no request and sees no response
when you follow one.

## Children

DevSummary is a developer tool and is not directed at anyone under 16.

## Changes

The startup dialog records the version of the terms you accepted. If these documents
change materially, the version is raised and the dialog asks again, showing what changed —
so you are never left agreeing to text you have not seen.
