# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Also see the root [AGENTS.md](../../AGENTS.md) for monorepo-wide commands and the **DevSummary product spec** (user flows, AI usage, frontend screens), and `docs/MIGRATION-PLAN.md` + `docs/DELTAS.md` for how this backend got here from the cloud original. This file covers the backend implementation.

## Commands

All commands run from `apps/backend/`:

```bash
pnpm start:dev              # Watch mode. Headless: no Electron shell, so no keychain and no port handoff
pnpm start:debug            # Debug + watch mode
pnpm test                   # Unit tests (Jest)
pnpm exec jest --testPathPatterns=<pattern>  # Single test file
pnpm test:watch             # Jest watch mode
pnpm test:e2e               # E2E tests (Vitest + in-memory PGlite). No Docker, no network
pnpm test:e2e:watch         # E2E watch mode
pnpm exec vitest run --config vitest.e2e.config.ts <path>  # Single e2e file
pnpm test:cov               # Coverage report
pnpm lint                   # Lint + autofix
pnpm format                 # Prettier on src/ and test/
```

Normal operation is `pnpm dev` from the repo root, which builds the packages and starts Vite plus the Electron shell; the shell forks this backend as a utility process and hands it `API_TOKEN`, `DATA_DIR` and the decrypted secret bundle. A bare `pnpm start:dev` runs against `./.data` with no credentials — useful for wiring work, useless for anything that talks to GitHub or an LLM provider.

### Database (a local PGlite directory — no Docker, no server)

Migrations are applied **at boot** by `KyselyModule`, so these scripts exist only for authoring new ones. `kysely.config.ts` points kysely-ctl at the same `createAppDatabase()` the app uses, against `DATA_DIR` (default `./.data`).

```bash
pnpm db:generate            # Scaffold a blank Kysely migration (kysely migrate:make)
pnpm db:up                  # Apply migrations (normally redundant — boot does this)
pnpm db:down                # Rollback last migration
pnpm db:status              # List migrations
pnpm db:fresh               # Reset: rollback all + re-apply (destructive)
```

A new migration must also be added to `src/databases/kysely/migrations-index.ts` — the boot path uses a **static array**, not a directory listing, because a packaged asar cannot be listed reliably.

## Architecture

### Module Graph

```
AppModule (RequestIdMiddleware + LocalSessionMiddleware on all routes)
├── ConfigModule (global)
├── LoggerModule ──────────── nestjs-pino
├── KyselyModule (global) ─── PGlite + KYSELY_DB token; runs migrations in onModuleInit
├── JobsModule ────────────── jobs table + in-process runner + scheduler (replaces Temporal)
├── LocalSettingsModule ───── @Global: SecretsService, LocalSettingsRepository, settings API
├── OrganizationsModule ───── registers OrgContextGuard as an APP_GUARD
├── GithubIntegrationsModule ─ PAT connect, repo reconcile, branch tracking
├── SlackIntegrationsModule ── bot-token paste, channel/member listing, message posting
├── CommitAnalysisModule ───── commit ingestion + LLM analysis
├── GithubCollaboratorsModule ─ repo collaborator sync
├── BriefsModule ───────────── projects, teams, schedules, generation, delivery
├── AnalyticsModule ────────── dashboard activity buckets
├── JobActivityModule ──────── the background-jobs toast, backed by the jobs table
└── HealthModule ──────────── readiness (PGlite ping) + liveness
```

**One process.** The API/worker split is gone with Temporal: `src/main.ts` boots this graph *and* runs the job runner. `src/worker.ts` does not exist.

`LocalTokenGuard` is registered as a root-module `APP_GUARD` so Nest's scan order puts it ahead of `OrgContextGuard` — the loopback token is checked before anything reads a workspace.

### Entry Point & Body Parsing

**`src/main.ts`** — pins `process.env.TZ ??= 'UTC'` as its first statement, boots with `bufferLogs: true`, calls `configureApp(app)` (shared with the e2e harness), then `app.listen(0, '127.0.0.1')` and posts the OS-assigned port back over `process.parentPort` so the Electron main process knows where to point the window. Binding port 0 on loopback is deliberate: nothing on the LAN can reach it, and there is no fixed port to collide with.

**`configureApp`** (`src/bootstrap/configure-app.ts`) wires the pino logger, CORS, the global `AllExceptionsFilter`, and shutdown hooks. **CORS is dev-only** (`origin: http://localhost:5173`): a packaged renderer loads from `file://`, which sends no meaningful origin and is not subject to CORS anyway, so production emits no CORS headers at all. The real trust boundary is `LocalTokenGuard`.

**Body parsing is global** (Better Auth was the only reason it was ever disabled), but several modules still apply `express.json()` in their own `configure()`. Those calls are harmless and were left in place.

### Graceful-degradation config pattern

Integrations must not fail boot when a credential is missing — on a desktop install the user has not pasted one yet, and the app has to open so they can.

**Read credentials live, do not snapshot them at module init.** `loadCommitAnalysisConfig` and `loadBriefsConfig` return objects whose `llm` is a **getter** over `ConfigService` (`loadLlmSettings`, so it resolves the provider, that provider's key and its model override together), and `SecretsService.update()` writes into `process.env`, which `ConfigService.get` falls through to. That is what makes a key pasted into the settings screen take effect on the next job instead of the next launch. A null `llm` is the not-configured signal, turned into a rejecting client at call time (`LiveLlmClient.parse`, and checked up front by `BriefGeneratorService.generate`) and surfaced as `AppError.OPENAI_NOT_CONFIGURED`. There is no not-configured stub decided at boot; a factory that decides "configured" once is the bug this replaced.

GitHub is the same shape by a different route: the PAT is a stored row, not env, so `GithubAppClient`'s token resolver throws `GITHUB_APP_NOT_CONFIGURED` when there is nothing to open — which covers every method, where the old stub covered only some.

### LLM provider (`src/common/llm/`)

Every LLM call goes through the abstract `LlmClient`: `parse(zodSchema, schemaName, { systemPrompt, userPrompt })` -> `{ parsed, model, promptTokens, completionTokens }`. It is also the **DI token** both consuming modules provide under, so nothing above it knows — or can ask — which provider answered.

`LlmClient` (`llm-client.ts`) owns everything that is not provider-specific: the lazy per-instance SDK load (via `createRequire` under Jest, because `openai` is ESM-only and only a `require` reaches the manual mock), the `try`/`catch` that maps a transport failure to `OPENAI_API_FAILED`, the `safeParse` against the Zod schema, and the result shape. A subclass implements exactly one method, `request()`, returning `{ raw, promptTokens, completionTokens }` — so a third provider is one new file plus one line in the factory's map, with no opportunity to invent its own error codes or token-count keys.

| Subclass | File | Transport |
| --- | --- | --- |
| `OpenAiLlmClient` | `openai-llm.client.ts` | Responses API (`responses.parse` + `zodTextFormat`); usage under `input_tokens`/`output_tokens`, body arrives already parsed |
| `GeminiLlmClient` | `gemini-llm.client.ts` | `chat.completions.create` against `GEMINI_BASE_URL`; usage under `prompt_tokens`/`completion_tokens`, body arrives as a JSON *string* |
| `AgentCliLlmClient` | `agents/agent-cli-llm.client.ts` | spawns a local coding-agent CLI (`claude`, `opencode`, `agent`, `codex`) — no SDK, no key; prompt on stdin, schema on argv, in the child's env, prepended to stdin, or written to a file per adapter, 5 concurrent processes (2 for OpenCode), 120 s timeout |
| `UnconfiguredLlmClient` | `unconfigured-llm.client.ts` | none — overrides `parse()` to reject with `OPENAI_NOT_CONFIGURED`, so no key is read and no SDK is loaded |
| `LiveLlmClient` | `live-llm.client.ts` | **desktop-only**, see below — resolves settings per call and delegates to one of the four above |

- **The provider is chosen per call, not at boot.** This is the one place the desktop diverges from the webapp: there, `createLlmClient(loadLlmSettings(config))` in a module factory is correct for the life of the process, because the provider and the keys are env at fork time. Here they are written by the settings screen at runtime, so both modules provide `LlmClient` as `new LiveLlmClient(() => cfg.llm)`, and `parse()` re-resolves the settings and delegates. The delegate is cached while `provider`/`apiKey`/`model` are unchanged — a rotation or a provider switch invalidates it, an unchanged config reuses one SDK client.
- **Import `LlmClient` as a value, never `import type`.** It is the DI token, and an `import type` in a consuming service erases the class, which drops it from the emitted `design:paramtypes` — no error, just an `undefined` dependency the first time a brief is generated.
- **Selection.** `LLM_PROVIDER` (`openai` | `gemini` | `claude-code` | `opencode` | `cursor` | `codex`, default `openai`) is what the AI page writes; `COMMIT_ANALYSIS_LLM_PROVIDER` and `BRIEFS_LLM_PROVIDER` still override it per workload if they are in env, but nothing in the app writes them and there is deliberately no UI for them. An unrecognised value **throws** rather than falling back — silently defaulting a typo'd `gemeni` to OpenAI spends money on the provider the operator believed they had left. `LocalSettingsService.provider()` is the one exception (it falls back), because the AI page is where such a value would be fixed.
- **Only the selected provider's key is read.** `loadLlmSettings` returns null when it is missing, which is what produces the stub; having the *other* provider's key stored changes nothing.
- **One SDK.** Gemini is reached through its OpenAI-compatible endpoint, so the `openai` package serves both and no second dependency exists. `GeminiLlmClient` pins that base URL itself instead of trusting `LlmSettings.baseURL`, because a client built from settings that omitted it would send a Gemini key to `api.openai.com` and the 401 would come back looking like a transport failure. That endpoint implements `/chat/completions` and **not** `/responses`, which is the entire reason the subclass exists.
- **A malformed body is not a transport blip.** Whatever a subclass can already tell is a bad *response* — empty `output_parsed`, empty content, unparseable JSON — it raises as `OPENAI_RESPONSE_INVALID` from inside `request()`, and `parse()`'s catch re-throws an `ApiException` untouched rather than wrapping it. Wrapping it as `OPENAI_API_FAILED` would put a garbage response back on the retry path meant for network faults.
- **`toGeminiJsonSchema` is not optional** (`gemini-schema.ts`). Gemini's `responseSchema` accepts a narrow keyword set and rejects the request outright on anything else — including `additionalProperties`, `minLength`/`maxLength` and `$schema`, all of which `z.toJSONSchema` emits for `BriefOutputSchema` and `CommitAnalysisOutputSchema`. Dropping the string bounds costs nothing: every response is `safeParse`d against the full Zod schema on the way back. When pruning, note that keys under `properties` are user field names — a field called `type` must not be filtered as if it were a keyword.
- **An agent CLI is a provider, not a fallback.** `LLM_PROVIDER=claude-code` / `opencode` / `cursor` / `codex` selects that binary on the user's machine. `loadLlmSettings` returns settings with **no** `apiKey` for it — there is nothing to be missing, so it is never the null that produces the stub — and whether the binary is actually there is answered by `AgentCliDetector` at call time. A missing or logged-out CLI fails the job the same way a missing key does; there is deliberately no silent fallback to a key provider.
- **The adapter never spawns** (`agents/agent-cli.adapter.ts`). It builds argv and interprets stdout, so it is pure and unit-testable against fixtures, and another CLI is one file plus one entry in `AGENT_ADAPTERS`, `AGENT_PROVIDERS`, `LLM_PROVIDERS`, `DEFAULT_MODELS`, both `*_MODEL_VARS`, `SECRET_KEYS`, `LlmProviderName`, `AgentCliProviderName` and the frontend's `PROVIDERS`. The detector, the client, the endpoints and the card are generic.
- **Not every CLI is configured on argv**, which is what the adapter's optional hooks are for — `env(req)` for a child environment, `stdin(req, userPrompt)` for a CLI that wants the system prompt and schema in the prompt body (Cursor), `workspaceDir` for one that reads instruction files out of its working directory (the client creates it recursively *and* spawns the child in it), `maxConcurrent` to lower the shared five-process cap (only OpenCode does), and `files(req)` for one that takes an argument as a path rather than a value (Codex's `--output-schema`; the client creates each parent directory and writes the content, tmp-file-then-`rename`, because the paths are deterministic and two concurrent calls can name the same file). OpenCode has no `--system-prompt`, no `--json-schema` and no tools flag: its whole agent — system prompt *and* `permission {"*": "deny"}` — is inline JSON in `OPENCODE_CONFIG_CONTENT`, selected with `--agent devsummary`. `runCli` merges that over `process.env` (never replacing it), and the client feeds `env()` and `buildArgs()` the same request object so they cannot describe different calls.
- **Every agent CLI reads its working directory into the prompt, so none of them runs in the process cwd.** `AgentCliLlmClient` spawns the child *in* `adapter.workspaceDir` (an empty directory under `DATA_DIR`, built by the shared `scratchDir` helper) rather than merely creating it — Cursor's `--workspace` and Codex's `-C` only close the half those flags cover, and `claude` has no such flag at all, so the cwd was the only lever. Measured on the real `CommitAnalyzerService` over commit `073b8e5` (26 files, 57 062 diff chars, `haiku`): **44 228** prompt tokens with cwd on `apps/backend`, **23 708** in the empty directory. This backend's own `AGENTS.md` was being prefixed to every commit analysed — half the prompt, on every commit, describing code the commit is not about. What survives is the user's own `~/.claude/CLAUDE.md`, for which there is no flag. `--strict-mcp-config` and `--disable-slash-commands` were measured too and changed nothing (`--tools ''` already leaves nothing to load), so neither is passed.
- **The concurrency cap is derived from the machine — half the cores, 2 to 5** (`DEFAULT_MAX_CONCURRENT`). It was a flat two, carried over from the key providers, where a fan-out spends one metered quota and the cap is about the quota; a CLI spawns a whole agent runtime per call, so the laptop is the constraint. Measured on an M3 (8 cores, 16 GB) with `claude`, counting only our own children: one process peaks at **296 MB / 94 % of a core**, five at **1224 MB / 320 % of 800 %**, and five calls take 19 s where one alone takes 14 — throughput ×3.7, with the cost concentrated in each CLI's startup rather than the wait that follows. Five is the ceiling because `BATCH` in `commit-analysis.jobs.ts` is five and a higher cap would never be reached; **the floor of two is the point of the formula** — this is a desktop app the user is looking at, half the cores is what leaves the other half for them, and a 4-core machine therefore gates exactly where it did before. Note brief generation has its own client and its own cap. OpenCode overrides it down to 2 (`maxConcurrent`): its default model is OpenCode Zen's free tier, where a spent quota is not an error but a silent internal retry loop until our 120 s timeout, so more processes buy nothing and lose the batch.
- **Cursor is the `agent` binary, not the `cursor` editor launcher.** It takes the system prompt, schema and user prompt through stdin, and runs with `--mode ask` as the read-only lock plus `--trust` for headless execution — `-p` alone, in the CLI's own help, "has access to all tools, including write and shell", so ask mode is the whole boundary (verified: asked to write a file and run `id`, the workspace stayed empty). Never add `--force`, `--yolo`, `--auto-review` or `--approve-mcps`. `--workspace` points at an empty scratch directory so this repository's `AGENTS.md` never enters the model prompt, and it lives under **`DATA_DIR`, not `tmpdir()`** — on Linux `tmpdir()` is the shared `/tmp`, where a fixed path can be pre-created or symlinked by another local user and `mkdir(…, { recursive: true })` would follow it, handing Cursor a workspace of someone else's choosing. The directory must exist: `--workspace` on a missing path exits **2** with no envelope, which is why `AgentCliLlmClient` creates `adapter.workspaceDir` before spawning.
- **Cursor's remaining ceilings**, both measured in `docs/receipts/AGENT-CLI-CURSOR.md`: every spawn carries **~14.5k input tokens** of Cursor's own preamble before our prompt, with no flag to strip it (the cost argument for packing 8 commits per spawn), and the user's global `~/.cursor` rules and `mcp.json` are still the CLI's own state — the empty workspace only closes the *project* half, exactly as OpenCode's global instruction file does.
- **`inputTokens` excludes cache, so Cursor's three usage fields are summed.** Measured on two identical calls: `{input: 14511, cacheRead: 4352}` then `{input: 15, cacheRead: 18848}`. This is the opposite of OpenCode's `output`/`reasoning` overlap and was measured rather than assumed — do the same for the next CLI.
- **Codex is the one adapter whose model can still run a shell**, and the sandbox is the whole boundary. `codex exec -s read-only` refuses writes and has no network, but `exec` always has a shell tool and no config key removes it — `tools.shell`, `tools.local_shell` and `experimental_supported_tools` are all rejected by `--strict-config`. Reads are **not** confined to the workspace: an absolute path still works. Prefer Claude Code (`--tools ''`), OpenCode (`permission {"*": "deny"}`) or Cursor (`--mode ask`) when either will do. Never add `--dangerously-bypass-approvals-and-sandbox`, `--dangerously-bypass-hook-trust`, `--approve-for-me`, `--add-dir`, or `-s workspace-write` / `danger-full-access`.
- **Codex needs `shell_environment_policy.inherit="none"` *and* `allow_login_shell=false`, and neither works alone.** `SecretsService` writes the decrypted bundle — OpenAI key, GitHub PAT, `DB_ENCRYPTION_KEY` — straight into `process.env`, and every command the model runs inherits it. The environment policy on its own is a placebo: codex runs commands through `/bin/zsh -lc`, and a login shell re-sources the user's profile and rebuilds what was just denied. Measured with a canary variable, three times, before the second key was found (`docs/receipts/AGENT-CLI-CODEX.md` row 5).
- **Codex's schema goes in a file and its system prompt goes in a config override.** `--output-schema` takes a path, which is why the adapter has a `files` hook; `-c instructions=<TOML string>` **replaces** the base system prompt (14 082 input tokens per spawn before, 10 543 after) and is the only system-prompt slot `exec` has. The value is `JSON.stringify`'d because a `-c` value is parsed as TOML and JSON's escapes are a subset of TOML's — an unquoted prompt starting with `[` would be read as a table. `--skip-git-repo-check` is load-bearing (the scratch workspace is not a git repo), and a missing `-C` directory or schema file exits 1, so the client's `mkdir` and file write are required rather than defensive.
- **Codex `input_tokens` is the total, and an `error` item is not a failure.** `cached_input_tokens` and `cache_write_input_tokens` are breakdowns of `input_tokens`, and `output_tokens` already includes reasoning — so nothing is summed, the opposite of Cursor. And codex reports "Model metadata not found" and "Skill descriptions were shortened" as `item.completed` events of type `error` on runs that answer perfectly; only `turn.failed` means the turn failed. Its remaining ceiling is the ~10.5k-token preamble of the user's skills and plugins, which `--ignore-user-config`, `--ignore-rules` and `--disable plugins` all fail to remove.
- **The login probe reads stderr when stdout is empty** (`AgentCliDetector.authenticated`). `codex login status` writes its one line to stderr, and parsing stdout alone reported every logged-in user as signed out on the provider card. Fixed in the detector, not the adapter: `parseAuth` only ever receives one string.
- **A failure reason is stored in `failure_reason` and rendered, so it is cleaned centrally.** Colour codes are stripped in `firstLine` (`agents/agent-cli.helpers.ts`) and the reason is clamped to 300 characters in `AgentCliLlmClient` — Cursor answers an unknown model with its entire 8 KB catalogue on one line, and answers a bad key in ANSI yellow. Neither belongs in a per-adapter fix.
- **What the adapters share lives in `agents/agent-cli.helpers.ts`**: `firstLine`, `parseStdout`, `isEnvelope`, `stripFence`, `sumTokens`, `parseJsonLines`, `lastOfType`, `scratchDir` and `jsonContractPrompt`. That last one is the reason the file exists — it is the JSON-only contract the *model* reads, used by both OpenCode (as its inline agent prompt) and Cursor (prepended to stdin), and two hand-kept copies drift with nothing failing to compile. Anything that names one CLI's fields stays in that CLI's adapter. Nothing in the helpers imports `agent-cli.adapter`: a cycle back resolves to `any` in the type-aware lint pass and silently unchecks every call site.
- **OpenCode's exit code carries no information.** It exits **0** for a provider 401 (an `error` event on stdout) *and* for an unknown model (stdout empty, an ANSI-coloured Bun stack trace on stderr), so the events decide and stderr is read only when there were none. It also has no auth probe — credentials are per provider inside opencode, so `authenticated` stays `null` — and no event names the resolved model, so the client falls back to the configured string.
- **A throttled provider is a silent retry loop inside opencode, not an error event.** OpenCode Zen answers `Rate limit exceeded` and opencode retries internally with backoff while emitting **no** JSON at all, so our side sees an empty stdout until the 120 s timeout. That is what the adapter's optional `stderrHint(stderr)` is for: `opencode` runs with `--print-logs --log-level ERROR` (the only level that is silent on a healthy call — WARN writes ~260 kB, INFO/DEBUG overflow the 16 MiB read buffer), and the hook lifts the reason out of the `service=session.processor` line. `AgentCliLlmClient` appends it as `; last CLI error: …` to the timeout reason. **Never widen that hook to "the first ERROR line"**: opencode's `service=llm` lines embed `requestBodyValues.messages`, i.e. the system prompt and the commit diff, and the reason string is stored in `failure_reason` and shown on screen.
- **`--agent` failing to resolve is a trust-boundary failure, and `parseOutput` refuses the run.** If `OPENCODE_CONFIG_CONTENT` ever stops defining `devsummary` (a renamed env var, or a machine-managed config — that one merges *after* it), opencode prints `Falling back to default agent` to stderr and runs its default **build** agent: no system prompt, no schema, no `permission {"*": "deny"}`, tools live in the backend's own working directory, with a commit diff as the prompt. There are events in that case, so the stderr check has to come *before* stdout is trusted. Also note the agent `prompt` replaces only opencode's default *build* prompt: the `<env>` block and one global instruction file (`~/.config/opencode/AGENTS.md`, else `~/.claude/CLAUDE.md`) are still appended **after** our JSON-only instruction, and 1.1.53 offers no way to suppress the global one — `instructions: []` is unioned, not replaced. `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1` at least keeps a personal Claude Code memory from being the file that wins.
- **Two flags must never be passed to `claude`.** `--bare` drops the claude.ai login and every call answers `Not logged in`. `--disallowedTools "*"` blocks the internal `StructuredOutput` tool and the model answers in prose; `--tools ""` is how tools are removed.
- **Detection executes, it does not just locate** (`agents/agent-cli.detector.ts`). An Electron GUI process inherits a minimal `PATH` with no `~/.local/bin` and no nvm, so the binary is resolved through `$SHELL -lic 'command -v <binary>'` when `PATH` misses — and then **run** with its version flag, because a path found on `PATH` can still fail `ENOENT` on spawn (the Codex case). The detector is a module singleton with a 60 s cache, not a Nest provider: `BriefsModule` and `CommitAnalysisModule` do not import `LocalSettingsModule`, and one cache beats three module graphs. `LocalSettingsModule` registers that same singleton under the class token purely so the settings service is testable.
- **`DEFAULT_MODELS` is per provider *and* per job.** A CLI wants the cheap model for per-commit volume and a stronger one for the brief people read (Claude Code: `haiku` / `sonnet`; Cursor: `composer-2.5-fast` / `composer-2.5`; Codex: `gpt-5.6-luna` / `gpt-5.6-terra`); OpenAI and Gemini keep the same value in both slots. `loadLlmSettings` therefore takes a `job: 'commitAnalysis' | 'brief'`.
- **Error codes keep the `OPENAI_` prefix** (`OPENAI_NOT_CONFIGURED`, `OPENAI_API_FAILED`, `OPENAI_RESPONSE_INVALID`) so stored `failure_reason` values and any client matching on them stay valid; the *messages* are provider-neutral.

### Database (Kysely over PGlite)

The `KyselyModule` (`src/databases/kysely/kysely.module.ts`) is a **global** module. Inject via the `KYSELY_DB` token:

```typescript
constructor(@Inject(KYSELY_DB) private db: AppDatabase) {}
```

`AppDatabase` is `Kysely<Database>`; both come from the `src/databases/kysely` barrel. Postgres is **PGlite** — real Postgres compiled to WASM, in a directory, no server and no Docker. `resolveDataDir()` returns `$DATA_DIR/data` (the Electron `userData` folder) or `./.data` headless. The instance runs **`CamelCasePlugin`** — code uses camelCase identifiers (`deletedAt`, `github.commitAnalyses`), SQL gets snake_case. Key conventions:

- **Table keys** in the `Database` interface (`src/databases/kysely/database.types.ts`) are camelCase and schema-qualified: `organizations`, `auth.user`, `github.commitAnalyses`, `briefs.briefSchedules`, `jobs`, `localSettings`, …
- **`updatedAt` is NOT auto-touched** — every `updateTable().set({...})` on a table with `updatedAt` must include `updatedAt: new Date()` (including upsert `doUpdateSet`).
- **jsonb columns** (`raw`, `changes`, `args`) are typed `Json<T>`: reads are parsed values, writes must be `JSON.stringify(...)` strings.
- **int8/bigint columns** (GitHub ids) come back as JS `BigInt` (`parsers: { 20: BigInt }` on the PGlite instance); un-cast `count(*)` / `sum(int8)` aggregates do too — cast `::int` in SQL or wrap `Number()`.
- **text[] columns** (`emailRecipients`, `deliveryEmails`) are plain `string[]` both directions.
- Row types keep the `*Select`/`*Insert` names (`ProjectSelect`, `BriefInsert`, …), exported from the same barrel.
- **PGlite has exactly one connection.** A `db.transaction()` holds it for its whole lifetime, blocking the other job loop and every HTTP request — which is why `JobRunnerService` claims a job with a single `update … returning` statement instead of a transaction. Keep transactions short and never open one around a network call.

PG schema namespaces: `public` (`demo`, `organizations`, `organization_members`, `organization_invites`, `jobs`, `local_settings`), `auth` (`user`, `session`, `account`, `verification` — Better Auth's tables, now holding one seeded user row; the shipped migrations are frozen so they stay), `github` (`installations`, `repositories`, `repository_branches`, `commits`, `commit_branches`, `commit_analyses`, `collaborators`, `repository_collaborators`, `webhook_events`), `slack` (`installations`), `briefs` (`briefs`, `brief_commits`, `brief_schedules`, `projects`, `project_repositories`, `teams`, `team_collaborators`), `marketing` (`waitlist`). Several of those tables are now unused (`organization_invites`, `webhook_events`, `marketing.waitlist`, most of `auth`) — the migrations that create them are shipped and **never edited**, so the tables stay and nothing reads them.

Migrations live in `migrations/`; `00001–00014` are copied verbatim from the cloud original and must never be edited. `00015_jobs.ts` adds the `jobs` and `local_settings` tables; `00016_seed_local_singleton.ts` seeds the one user row and the default workspace with the fixed UUIDs in `src/local/local-identity.ts`. Migrations must stay independent of application code: import only from `kysely` and write **literal snake_case** identifiers, since `CamelCasePlugin` is not installed on the migration connection.

Domain tables use UUID PKs, `created_at`/`updated_at`, and **soft deletes** (`deleted_at`) almost everywhere — repository queries must filter `deletedAt IS NULL`.

### Workspaces (`organizationId`)

Multi-tenancy survives the desktop port as local **workspaces** (`docs/DELTAS.md` D-A). `organizationId` is threaded through every table, query, guard and DTO; only its *source* changed.

- Org-scoped requests carry the **`x-organization-id` header**. `OrgContextGuard` (a global `APP_GUARD`) activates on routes decorated with `@RequireOrgRole(level)`: validates the header as a UUID, **falls back to `LOCAL_ORG_ID` when it is absent**, verifies membership and role rank, then attaches the membership to the request.
- Role levels for `@RequireOrgRole`: `'owner' | 'admin' | 'member'` — `member` means *any* role. DB roles are `owner | admin | viewer`. The seeded local user is `owner` of the default workspace and of every workspace it creates, so the checks are real but never fail in practice.
- `@OrgMembership()` injects `{ organizationId, userId, role }` in controllers.
- Controller: `api/organizations` — create, `/me`, `/current` (get/patch/delete). **The last remaining workspace cannot be deleted** (`ORG_LAST_WORKSPACE`, 409, checked before the irreversible teardown): there is no sign-up flow to re-seed one, so every org-scoped route would fall back to a `LOCAL_ORG_ID` that no longer exists. Members, invites and transfer-ownership are **deleted**: there is one user on this machine and no one to invite or transfer to.

### Identity and the API token (`src/local/`)

Better Auth is gone. There is no sign-in, no session store, no OAuth.

- **`local-identity.ts`** — `LOCAL_USER_ID` / `LOCAL_ORG_ID`, the fixed UUIDs migration `00016` seeds. Import these rather than hardcoding.
- **`local-session.middleware.ts`** — sets `request.session = { user: <seeded local user> }` on every request, so the ~40 controllers and services that read `request.session.user.id` compile and run untouched. `@Session()` comes from `src/local/session.decorator.ts`, not from a package.
- **`local-token.guard.ts`** — the actual trust boundary. The Electron main process generates a per-boot `API_TOKEN` (`randomBytes(32).toString('hex')`) and passes it to both the backend (env) and the renderer (preload bridge); every request must carry it as `x-desktop-token`. Registered as a root-module `APP_GUARD`, exempting only `/api/health*`. Loopback alone is not a boundary — any local process can reach 127.0.0.1.
- **`auth/crypto.ts`** — `encrypt()` / `decrypt()` / `deriveKey()`, AES-256-GCM. Still used for the stored GitHub PAT (`integrations/github/credentials.ts`) and the Slack bot token (`SlackInstallationsRepository`). The key derives from `DB_ENCRYPTION_KEY`, generated once by the shell and kept stable; changing it costs the user a re-paste and nothing else.

### Secrets (`src/local/settings/`)

`SecretsService` holds the credential bundle (`GITHUB_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DB_ENCRYPTION_KEY`, the five `SMTP_*`/`EMAIL_FROM` fields, `SLACK_BOT_TOKEN`, plus `LLM_PROVIDER` and the ten per-provider model overrides) in memory, seeded from env at construction. The three CLIs contribute only their model overrides — none has a key, because each uses the login already in the user's terminal. `update(partial)` writes memory **and** `process.env`, then posts `{ type: 'secrets:save', bundle }` over `process.parentPort` — the Electron main process encrypts it into `userData/secrets.bin` with `safeStorage`. Outside Electron there is no parent port, so an update is memory-only for the boot, which is right for headless dev.

**Nothing is ever read back out.** `GET /api/local-settings` answers booleans for the credentials, plus the selected `llmProvider`, the data directory and the two effective model names, which are not secrets. Anything that needs a value asks `SecretsService` inside the process.

### Errors

All in `src/common/errors/`:

- **`AppError`** (`application-errors.ts`) — sealed registry of typed error factories (50+ codes covering orgs, invites, integrations, briefs). Throw from services as `throw AppError.PROJECT_NOT_FOUND()`; each code carries its HTTP status and message. Add new codes here with `defineError({ status, message, details? })`.
- **`ApiException`** (`api-errors.ts`) — `HttpException` subclass whose body is the shared `ApiError` shape (`code`, `message`, `details?`).
- **`AllExceptionsFilter`** (`all-exceptions.filter.ts`) — global filter: skips `/api/auth/*`, wraps plain `HttpException`s, logs and converts unknown errors to a generic 500 `ApiException`.

### Logging

`nestjs-pino` configured in `src/logger/pino.config.ts`:

- `LOG_LEVEL` env (default `info`); redacts `authorization`/`cookie` headers.
- Request IDs: honors incoming `x-request-id` or generates a UUID; `RequestIdMiddleware` echoes it on responses.
- Transports: dev = pretty console + rolling file; production = file only. File via `pino-roll` at `LOG_FILE_PATH`; unset, it defaults to `$DATA_DIR/logs/app.log` (the `userData` folder the database already lives in — a packaged app's cwd is not writable) and falls back to `../../logs/app.log`, i.e. `<repo-root>/logs/`, only when `DATA_DIR` is unset too. Max size/retention via `LOG_FILE_MAX_SIZE`/`LOG_FILE_KEEP_FILES`.
- Use the standard NestJS `Logger` class in services/handlers — it routes through pino (`app.useLogger(app.get(Logger))` in main.ts).

### Background jobs (`src/jobs/`)

Temporal is gone. Background work is a `jobs` table plus an in-process poll loop, in **one** process with the API.

**The table.** `public.jobs`: `id`, `type`, `args` (jsonb), `state` (`pending|running|failed`), `attempts`, `max_attempts`, `run_at`, `phase`, `organization_id`, `error`. A **succeeded job is deleted**, so the table is a work queue, not a history — "drained" means empty.

**`JobQueueService.enqueue(type, args, opts)`** — the producer. `opts.id` is a stable dedup key, which is what `startDeduped` / `workflowIdConflictPolicy: USE_EXISTING` bought — a second enqueue over a `pending` or `running` row is a no-op, and over a **terminally failed** one it re-arms the row (`state='pending'`, `attempts=0`, `error=null`, fresh `run_at`). Without that re-arm a dead row holds its id forever, and every id here is derived from state rather than time: a failed `sweep:<repo>:<branch>:<runDate>` would block that repository's ingest until the next runDate, and a failed `brief:<id>` would make the stale-pending reaper a silent no-op. Ids: `scan:<repositoryId>:<branch>`, `analyze:<repositoryId>:<branch>:<sinceISO>`, `brief:<briefId>`, `sweep:<repositoryId>:<branch>:<runDate>`, `dispatch:<YYYY-MM-DDTHH:mm>`. `opts.phase` and `opts.organizationId` are the old `Phase` / `OrganizationId` search attributes, now columns.

**`JobRunnerService`** — two loops, 1 s idle poll. A claim is a single `update … where id = (select … limit 1) returning *` statement: atomic without a transaction, which matters because PGlite has one connection and a transaction would block the other loop and every HTTP request. `attempts` increments **at claim time**, so a job that kills the process still burns its budget. On boot, `update jobs set state='pending' where state='running'` requeues whatever the dead process was holding — in `onModuleInit`, before anything can claim. The **loops start in `onApplicationBootstrap`**, not `onModuleInit`: feature modules register their handlers in their own `onModuleInit` and `JobsModule` initialises before them, so a loop started that early can claim a job whose handler does not exist yet and fail it terminally as "no handler for job type".

**A handler is the whole workflow body** — one call, one attempt. Returning succeeds (the row is deleted); throwing hands the job to its retry profile. `continueAsNew` became `while (cursor)`; `startChild(…, ABANDON)` became another `enqueue` with a stable id.

**Retry profiles** (`job-profiles.ts`), carried over verbatim from `temporal/workflows/activity-proxies.ts` since the existing code was tuned against them:

| Profile | maxAttempts | initial delay | backoff | Used by |
|---|---|---|---|---|
| `standard` | 4 | 30s | ×2 | brief generation, collaborator sync |
| `slow` | 4 | 60s | ×2 | loc-stats, brief backfill, sweep |
| `twice` | 3 | 1s | ×2 | analyze-repo planning |
| `once` | 1 | — | — | due-brief dispatch |
| `ingest` | 4 | 30s | ×2 | scan / backfill / incremental ingest |

`startToCloseTimeout` and `heartbeatTimeout` are dropped: they existed to stop a worker sitting on a task while the server waited, and in-process there is no scheduler to defeat.

**Registering a handler.** Each feature registers its own in `onModuleInit`, so no module has to import every feature:

```ts
@Injectable()
export class MyThingJobs implements OnModuleInit {
  constructor(private readonly registry: JobHandlerRegistry) {}
  onModuleInit(): void {
    this.registry.register(JOB.myThing, (args) => this.run(args as MyThingInput));
  }
}
```

An unregistered type is not a crash — the runner fails that job terminally, the honest outcome for a row enqueued by an older build.

**`SchedulerService`** replaces the two Temporal Schedules with `setInterval`, both deduped on a clock-derived id (the old `ScheduleOverlapPolicy.SKIP`):

- **due-brief dispatch** every 60 s, id `dispatch:<YYYY-MM-DDTHH:mm>`.
- **repository sweep** every 15 min **and once on boot**, id `sweep:<YYYY-MM-DD>`. On boot because a desktop app is launched *because* the user wants current data.

Neither is catch-up machinery: `claimDue` claims on `nextRunAt <= now` and the sweep re-derives its window from what is stored, so a laptop closed for a week resolves in one run, not 10,080.

**Job catalog:**

| Type (`JOB.*`) | Handler | Phase | Purpose |
| --- | --- | --- | --- |
| `collaborators.syncRepo` | `CollaboratorJobs` | `fetching` | Syncs repo collaborators on connect/disconnect or on demand |
| `github.scanRepository` | `CommitAnalysisJobs` | `fetching` | One per (repository, branch), started when a branch becomes tracked; first read + analysis |
| `github.backfillCommits` | `CommitAnalysisJobs` | `fetching` | Pulls a specific commit range for one (repository, branch) |
| `github.ingestNewCommits` | `CommitAnalysisJobs` | `fetching` | One incremental read: plan the window, fetch the tail, analyse it |
| `github.sweep` | `CommitAnalysisJobs` | — (system-scoped) | Fans out one `ingestNewCommits` per tracked pair, 200 per page |
| `analysis.analyzeRepo` | `CommitAnalysisJobs` | `analyzing` | LLM analysis, `BATCH = 5` calls in flight as a rolling pool (was 50 on a pooled org key; this is the user's own quota from one laptop). One call carries one commit on a keyed provider and `COMMITS_PER_CALL` on an agent CLI |
| `briefs.generate` | `BriefJobs` | `generating` | `markGenerating` → `generateContent` → `deliver` |
| `briefs.backfill` | `BriefJobs` | `generating` | On schedule creation, creates historical briefs (never delivered) |
| `briefs.dispatchDue` | `BriefJobs` | `generating` | `claimDue`, then one `briefs.generate` per due brief |
| `loc.backfill`, `loc.backfillRepo` | `CommitAnalysisJobs` | — | LOC-stats backfill; defined but not started from application code |

`JobActivityService` (`src/jobs-activity/`) counts running jobs per phase straight off the table (`select phase, count(*) … where state = 'running' group by phase`). The `JobActivityResponse { active, fetching, analyzing, generating }` contract is unchanged, so the frontend needed no changes.

## DevSummary Domain

### HTTP route map

Every route except `/api/health*` requires the `x-desktop-token` header. Org-scoped routes read `x-organization-id` and fall back to the default workspace when it is absent.

| Prefix | Controller | Notes |
| --- | --- | --- |
| `api/organizations` | organizations | create, `/me`, `/current` (get/patch/delete) |
| `api/organizations/current/projects` | briefs/projects | CRUD + `PUT /:id/repositories` |
| `api/organizations/current/teams` | briefs/teams | CRUD + `PUT /:id/collaborators` |
| `api/organizations/current/brief-schedules` | briefs/schedules | CRUD + pause/resume |
| `api/organizations/current/briefs` | briefs/generation | list (cursor pagination + filters), get, `GET /:id/commits`, `GET /:id/report`, `POST /generate` (202 + jobId), `POST /:id/deliver` |
| `api/organizations/current/collaborators` | github/collaborators | workspace-wide collaborator list |
| `api/organizations/current/analytics` | analytics | dashboard commit-activity buckets |
| `api/organizations/current/jobs` | jobs-activity | background-job counts per phase |
| `api/integrations/github` | github | `GET` status, `POST /token` (paste a PAT), `DELETE` disconnect, `POST /installations/:id/sync` |
| `api/integrations/github/repositories` | github | `GET ingest-status`, `GET /:repoId/branches` (live from GitHub), `POST /branches` (batch: set each repo's branch **once** + start ingestion, 202; 409 on an already-configured repo) |
| `api/integrations/github/repositories/:id/collaborators` | github/collaborators | list, `POST /sync` |
| `api/integrations/github/repositories/:repoId/commits` | github/commit-analysis | commit/analysis endpoints, backfill triggers |
| `api/integrations/slack/installations` | slack | `GET`, `POST /token` (paste a bot token), `GET /scopes`, `DELETE /:id` (revokes) |
| `api/integrations/slack` | slack | `GET /channels`, `GET /members`, `POST /messages` |
| `api/local-settings` | local/settings | `GET` status (booleans + dataDir + effective models), `GET /usage` (token totals), `GET /agents` (installed agent CLIs, `?refresh=1` forces a re-detect), `PUT /credentials`, `POST /test-email`, `POST /agents/:id/test` |
| `api/health` | health | public; `GET /` readiness (PGlite ping, 200/503), `GET /live` liveness |

There is no webhook receiver, no OAuth callback and no internal queue endpoint — all three are deleted.

### Briefs pipeline (`src/briefs/`)

Scope types: **project** (repo group), **team** (collaborator group), **collaborator**, **repository** (optionally narrowed to one branch via `scope_branch`, guarded by a check constraint that only a `repository` scope may set it; `BriefScopeResolver` returns it as `branchFilter` and every commit query — generation, backfill bounds, and all five report queries — honours it as an `EXISTS` against `commit_branches`, never a join, so a commit on two branches is not counted twice). Projects/teams are org-scoped soft-deleted groupings with junction tables.

A **repository** scope is validated against the tracked set at the boundary — both `BriefSchedulesService.assertScopeInOrg` and `BriefsService.assertScopeInOrg` reject a repository with no branch chosen (`GITHUB_REPOSITORY_BRANCH_NOT_CONFIGURED`) and a `branch` that is not the one it reads (`GITHUB_REPOSITORY_BRANCH_NOT_TRACKED`). Without that, a schedule over an inert repository generates and *delivers* an empty brief on every tick forever with nothing pointing at the cause. Project and team scopes are deliberately not blocked the same way — their membership changes independently of the schedule — so the frontend labels unconfigured repositories in the project picker instead.

1. **Schedule** (`schedules/`) — CRUD with cadence (daily/weekly/monthly at a time in a timezone). `CadenceService` computes period windows and `nextRunAt`. Creating a schedule enqueues `briefs.backfill`.

   **`CadenceService` deliberately uses no date library.** `date-fns-tz` was removed from it: `toZonedTime`, `formatInTimeZone` and `fromZonedTime` all probe the offset by reading a server-local `Date`'s fields, so every result depended on the *server's* zone — under `TZ=America/New_York` an `Asia/Kolkata` 02:30 schedule fired at 03:30 on the US spring-forward day, and under `TZ=America/Santiago` (which transitions at midnight) period boundaries lost their first hour and `windowsInRange` looped forever on the doubled local midnight. In its place: `wallClockIn` (a cached `Intl.DateTimeFormat('en-CA', { hourCycle: 'h23' })` per zone), `offsetAt`, and `zonedInstant` (two-pass offset resolution, rounding a spring-forward gap up to the first valid local instant), with calendar arithmetic on `YYYY-MM-DD` keys. `@date-fns/tz@1.5` — date-fns v4's companion, a genuinely different design from `date-fns-tz@3` — was re-evaluated against this file in August 2026 and **also loses**, on two of four correctness checks. It resolves a nonexistent wall clock to *requested + gap width* (Lord Howe 02:15 → 02:45, want 02:30, the transition), wrong on 392 of 522 probes across all 130 forward transitions in tzdata 2026; and it still reads the system `getTimezoneOffset()` to compensate for the process zone, so `America/Santiago` 23:45 moves an hour between `TZ=UTC` and `TZ=America/New_York`, and `Pacific/Chatham` local midnight — i.e. `zonedStartOfDay`, which stored period boundaries depend on — moves with the host. It passes the "window is exactly the local day" check only by coincidence: day boundaries ask for 00:00 and every midnight gap starts *at* 00:00, so requested + gap width happens to equal the transition there and nowhere else.

**Do not reintroduce a date library here**, and do not "simplify" the two-pass resolution — it is what makes the result independent of the process zone. Semantics are byte-identical to the old implementation under `TZ=UTC`; the server-zone specs in `schedules/__tests__/cadence.service.server-tz-*.spec.ts` are the regression net.

   **Periods are half-open: `period_start <= authored_at < period_end`.** `PeriodWindow.end` is the *next* local midnight, exclusive — not `23:59:59.999`. An inclusive end did not tile: on a 25-hour fall-back day the repeated hour fell between one window's end and the next window's start and landed in no brief. Three things follow, and all three have been bitten already:

   - Every commit query bounds the period with `<`, never `<=`.
   - Every *label* formats `period_end - 1ms`, or it names a day the brief does not cover. Three call sites, not one: `formatPeriodLabel`, the `Period:` header in `buildBriefUserPrompt` (a label the *model* reads and repeats in prose), and the frontend helpers in `brief-utils.ts`.
   - The brief-list filters compare against the stored exclusive end with `period_end > from` and `period_end <= to`, and the frontend sends both bounds as exclusive local midnights. `>=` on `from` would wrongly match the brief covering the previous day, which now ends at exactly that instant.

   The exclusive end is `startOfDay(nextCalendarKey, tz)` — the *next key's* midnight, never `+24h` and never `+1ms`. That makes tiling structural rather than arithmetic: a window's `end` and the next window's `start` are the same expression on the same key, so whatever the two-pass resolution decides for an ambiguous or nonexistent local midnight, both sides get the identical instant. Verified across all 418 IANA zones × 3 cadences × a year: 180,524 windows, zero gaps or overlaps.
2. **Dispatch** (`jobs/scheduler.service.ts` + `generation/activities/`) — a 60 s `setInterval`, deduped on `dispatch:<YYYY-MM-DDTHH:mm>` (the old overlap policy `SKIP`), enqueues `briefs.dispatchDue`, whose handler runs `BriefActivities.claimDue` and then enqueues one `briefs.generate` per returned brief.

   `claimDue` runs in **two phases, one transaction per schedule** — never one transaction for the whole batch. Phase 1 reads up to `BRIEFS_DISPATCH_BATCH_SIZE` due schedule ids; phase 2 opens a transaction per id that re-locks that single row (`FOR UPDATE SKIP LOCKED`, re-checking the same due predicates), creates the brief rows, and advances `nextRunAt`. **Preserve the per-schedule transaction boundary**: a batch-wide transaction means one bad row aborts every tenant's dispatch while the per-row `catch` logs success, because Postgres answers `COMMIT` with `ROLLBACK` without raising.

   Three related guarantees live here: missed periods are all created but only the most recent one gets `deliver: true` (the rest are backfill-style, so a week of downtime cannot fan out a week of emails); briefs left `pending` past `BRIEFS_PENDING_REAP_MINUTES` are re-dispatched, covering a process that died after the claim committed; and a schedule that fails dispatch repeatedly accumulates `dispatch_failure_count` and is auto-paused at 5, so it stops holding the oldest `next_run_at` and starving healthy schedules. `briefs_schedule_period_active_unique` makes a duplicate claim a `23505` the claim path treats as "already claimed".
3. **Generate** — the `briefs.generate` handler runs `markGenerating` then `generateContent` (`BriefActivities`, backed by `BriefGeneratorService`) → `BriefScopeResolver` (scope → repo IDs + optional author filter) → fetch commits + their analyses → `buildBriefUserPrompt()` (truncates to `BRIEFS_MAX_PROMPT_CHARS`, default 30k) → `LlmClient.parse()` with Zod `BriefOutputSchema` → `{ title, summary }` (provider per `BRIEFS_LLM_PROVIDER`/`LLM_PROVIDER`; model `OPENAI_BRIEF_MODEL` / `GEMINI_BRIEF_MODEL`). Stores title/summary/token counts and links commits via `brief_commits` (`BriefCommitsRepository.replaceForBrief()`). Zero-commit periods produce "no activity" briefs without an LLM call.

   **`markGenerating` proceeds on `pending`, `failed` *and* `generating`.** Durability is whole-handler retry now, not Temporal replay, so the deduped `brief:<id>` job row is the single execution authority — a row that still exists means no run of the handler has finished. Refusing on `generating` wedged every brief whose process died mid-generation: the handler "succeeded", the row was deleted, and `reapStalePending` only ever looks at `pending`. `generated`/`delivered` still exit — those cost an LLM call to redo, and the brief detail view's per-channel button already re-sends them.
4. **Deliver** (`delivery/`) — `BriefDelivererService` sends email (SMTP, HTML from `BriefRenderService`), Slack (markdown via `SlackMessagesService`) and, when enabled, a desktop notification, in parallel; then sets brief status `delivered`/`failed` (+ `failureReason`) and `schedule.lastSentAt`. Backfilled briefs skip delivery.

Brief listing uses base64url cursor pagination with filters (scheduleId, scopeType, period, excludeNoActivity).

**A brief's period carries its own timezone.** `period_start`/`period_end` are instants, but they are *local midnights in the schedule's zone*, so nothing can render or bucket them without that zone — and a schedule's `timezone` is editable, so reading the live schedule row re-tiles history. `briefs.briefs.period_timezone` is snapshotted at creation (from the schedule; `'UTC'` for on-demand briefs, and the column's default, which is exactly what pre-existing rows already behaved as). Every consumer reads that column: the `briefInfoTitle` label, `buildBriefUserPrompt`'s `Period:` header, `BriefReportService`'s day tiling, and `BriefResponse.periodTimezone` for the frontend. **Anything new that formats or buckets a brief period reads it too** — never the schedule, never UTC, never the viewer's zone.

`BriefReportRepository` takes days as **instant ranges** and names no zone in SQL at all (`ReportDay { key, from, to }`, resolved in `BriefReportService`). Keep it that way: a schedule may hold a legacy alias like `Asia/Calcutta`, which every JS runtime accepts and a Postgres without `tzdata-legacy` rejects outright, taking the whole report down.

**A brief covers what *landed* on the tracked branch during the period**, so commit selection runs on **`committed_at`** — the same clock the ingest high-water mark uses (`findNewestCommittedAtOnBranch`; GitHub's `since` filters on commit date). Keep both halves on one clock. When they disagreed, a rebased branch was fetched, stored and analyzed on its committer date and then failed selection on its stale author date, landing in *no* brief at all: the period it belonged to was closed, `briefs_schedule_period_active_unique` blocks a second brief for it, and `claimDue` only walks forward.

`briefs.briefs.commit_clock` snapshots which clock a brief was generated under (`'authored'` for everything predating the switch, `'committed'` since). `BriefReportService` reads it and threads it into every period-bounded query. **It is a fixed identifier, never an interpolated string** — map the union to `sql.ref(...)` through a lookup that throws on anything unexpected. Without the snapshot, old reports would print totals contradicting the `commit_count` on their own brief, which is what the comment at `brief-report.repository.ts:115-120` guards.

Two things deliberately left on author date: `analytics/` dashboard buckets (a live-queried surface where nothing can be lost, and switching would shift every historical chart), and, unavoidably, teams that merge with `--no-ff` — those branch commits keep their original committer dates, so their landing date is off by the branch's lifetime. The exact fix for that is a landing timestamp stored at ingest time, resolved differently for a historical read than an incremental one.


### GitHub integration (`src/integrations/github/`)

- Uses a **fine-grained personal access token** the user pastes, not a GitHub App and not OAuth: an Electron app has no public callback URL. `GithubAppClient` keeps its name (it is the DI token every consumer injects) and its whole method surface; only authentication changed — one user PAT instead of per-installation App tokens. As a bonus it sees repositories through the *user's* access, which fixes the fork-inherited-collaborator gap the App had.
- **Connect:** `POST /api/integrations/github/token` validates the token against `GET /user` and `GET /user/repos` with a throwaway client *before* anything is stored, then writes the row (token sealed with AES-256-GCM into `installations.raw` — there is no dedicated column and shipped migrations are frozen), reconciles repositories (upsert + soft-delete missing), updates `SecretsService` so the keychain bundle and `GET /api/local-settings` agree, and fans out collaborator sync. Re-pasting a rotated token updates the row in place; deleting and recreating it would orphan every repository and commit under it.
- **`GET /user/repos` is not the token's grant set, so `listInstallationRepos` filters it.** That endpoint enumerates by **account affiliation**, and a fine-grained PAT additionally carries implicit read-only access to every **public** repository — so "Only select repositories" never narrows the response. Measured against a real PAT scoped to one repository: 72 repositories came back, all public, and the *selected* one was **absent** (a private repo the token has no metadata grant on is invisible here). The picker was therefore offering 72 repos the token cannot summarise while hiding the one it can. GitHub exposes no endpoint that enumerates a fine-grained PAT's selected set (`GET /installation/repositories` is installation-token-only, 403 for a PAT), so the grant is **probed**: `/collaborators` is gated on `metadata=read`, which a PAT holds only for its selected repositories and which public read does not satisfy. Private repos are never probed — appearing in `/user/repos` already proves the grant. The probe **fails open on a rate limit** (`isRateLimitedError`, exported from `github.client.ts`): GitHub reuses 403 for a spent quota, and reading that as "no grant" would reconcile the user's repositories, commits and briefs away, so partial evidence abandons the filter instead of applying it. Cost is one request per public repository (`GRANT_PROBE_CONCURRENCY` 8) — see the `ponytail:` note on the method for the caching upgrade path.
- **Filtering the GitHub call is only half the fix — the picker reads stored rows.** `GET /api/integrations/github` serves `github.repositories` via `withRepos`, so a narrowed token changes nothing until something *reconciles*. `connect` therefore refuses a grant-less token only when there are **no live repository rows to correct** (`beforeIds.length === 0`, not `!existing` — a disconnected workspace keeps a revivable installation, so testing the installation row would accept a useless token for any account that had ever connected). With live rows present the paste goes through and clears them, and `sync` reconciles to zero as well: sync is the button a user presses *because* the list looks wrong, so refusing would make the only control that can clear stale rows the one that cannot. The clear is soft and reversible — re-pasting a working token undeletes the rows with their commits — and a rate-limited probe never reaches it, because `listInstallationRepos` fails open to the unfiltered list rather than reporting an empty grant set. `test/e2e/specs/github-repo-grants.e2e.spec.ts` pins all four cases against the booted app; the "grants nothing" case is the one that failed when only the GitHub call was filtered.
- **`GITHUB_TOKEN_GRANTS_NO_REPOS`** (400) is the first-time-connect refusal. It reads differently from a bad-token error on purpose: authentication succeeded, so the message points at the token's "Repository access" selection rather than at expiry.
- **Known false negative:** `/collaborators` also wants push access for the authenticated user, so a public repository the user is merely a read-only collaborator on probes 403 and is dropped despite being granted. Check that first if a repository goes missing from the picker; see the `ponytail:` note on `listInstallationRepos`.
- **A 403 from `/collaborators` is skipped, not failed.** That endpoint is gated on `metadata=read`, which a PAT holds only for its selected repositories — so it 403s (`Resource not accessible by personal access token`) on exactly the repos the bullet above lists via implicit public read, which is most of them. It used to throw, leaving one permanently-failed `collaborators.syncRepo` job per repository on every connect (72 repos × 4 attempts). `CollaboratorSyncService` now logs and returns, keeping stored join rows — a narrowed token must not delete what a broader one synced, and 404 already covers "the repo is really gone". Briefs are unaffected: scoping comes from commit authorship (`upsertManyFromCommitAuthors`), not this access list. **A rate-limit 403 is still rethrown** (`isRateLimited` checks `x-ratelimit-remaining`/`retry-after`) — GitHub reuses 403 for a spent quota and that one is worth retrying.
- **Commit ingestion is never started by connect or sync.** A repository is read only on the branch it is tracked on — `github.repository_branches`, partial-unique on `(repository_id, branch) where deleted_at is null`. No live row = the repo is inert (no fetch, no analysis, no contribution to briefs). `RepositoryBranchesService.setBranches` (`POST /api/integrations/github/repositories/branches`, admin) is the only caller that enqueues `github.scanRepository`, with the request's `lookbackDays` (30/90). `MAX_HISTORY_DAYS` (90, in `@launchstack/api-interfaces`) is the ceiling on history *everywhere*. **One repository reads one branch**: the request carries a single `branch` per repository, and nothing writes a second row.
- **The choice is write-once.** `RepositoryBranchesRepository.setBranchOnce` refuses any second write for a repository — no swapping, no second branch — and the service turns that into `GITHUB_REPOSITORY_BRANCHES_LOCKED` (409). It is deliberately restrictive: changing it re-reads history and spends LLM tokens, and because attribution lives in `commit_branches` the old branch's commits would stay behind and keep appearing in briefs. The check and the insert run in one transaction behind a `SELECT … FOR UPDATE` on the repository row, because two concurrent Starts would otherwise both read an empty set and insert *different* branches, which no unique index catches.
- **Branch is an argument, never a lookup.** `github.scanRepository` / `github.backfillCommits` and the `backfillFromLatest` / `backfillCommits` activities all carry `branch`; `CommitBackfillService` verifies it is still tracked and throws `GITHUB_REPOSITORY_BRANCH_NOT_TRACKED` otherwise. `POST /repositories/:repoId/commits/backfill` fans out one job per tracked branch (or takes an explicit `branch`).
- **Commit attribution:** `github.commit_branches` records which branches a commit was seen on — one row per `(commit_id, branch)`, many per commit, because branches share ancestry. `CommitsRepository.upsertMany` returns ids for already-present commits too (`DO UPDATE` + `RETURNING`, not `DO NOTHING`) so a commit first ingested from another branch still gets attributed; `linkToBranch` is idempotent.
- Branch lists come from `GithubAppClient.listBranches` (GraphQL `refs` ordered by commit date, capped at 3 pages, `truncated` flag). REST's `/branches` carries no commit date, which is why this is GraphQL.
- **There are no webhooks.** A desktop machine has no public URL, so `push` deliveries cannot arrive; the webhook controller, the signature verifier and the push-event parser are all deleted, and `github.webhook_events` is a dead table. **Polling is the only ingest path**: `SchedulerService` enqueues `github.sweep` on boot and every 15 minutes, which fans out one `github.ingestNewCommits` per tracked (repository, branch). It is cheap by construction — a repository with nothing new costs two indexed queries and no GitHub call.
- **A read fetches only what is missing**, decided by `CommitBackfillService.planIngest`. The window starts at `min(newest committedAt on the branch, earliest named timestamp)` rather than a lookback window — `committedAt` because that is what GitHub's `since` filters, the `min` because a force-push can rewind the branch to an older base.
- **A branch with no stored history is adopted, not skipped.** `planIngest` returns `mode: 'adopt'` and the handler runs `backfillFromLatest` with `ADOPT_LOOKBACK_DAYS` (30) — the same lookback-bounded first read branch setup performs. That recovers a repository whose setup scan failed, or one tracked while the app was closed. Adoption is keyed on "nothing stored", **not** on the trigger.
- **Commit analysis batches per call when the provider is an agent CLI** (`CommitAnalyzerService.commitsPerCall`). There a call is a *local process* and its startup is most of the cost: a trivial prompt answered in 17.0 s and 9 610 prompt tokens, a real 57k-char commit in 17.3 s and 23 708 — so `COMMITS_PER_CALL` (4) commits share one spawn, and the fan-out in `analyzeRepo` chunks the page by that number. Measured live on the real analyzer over four real commits: **5.8 s per commit against 22.9 s** one spawn each, all four keyed correctly. A keyed provider stays at one commit per call — a call there is an HTTP request, and packing them would only lose the parallelism the fan-out already has. The budget is per *call* (`maxDiffChars / batch size`), so a batched commit gets ~15k diff chars instead of 60k; `packDiff` spends that on the smallest files first and lists the rest by path and line counts.
- **Every route back to a single call in `analyzeCommitBatch` is deliberate.** The `Map<sha, result>` `analyzeCommits` returns is the contract: **absent means unanswered**, and an unanswered commit — a short answer, or an entry under a sha nobody asked for — is analysed alone, because the alternative is writing one commit's summary onto another's row. A malformed *batch* answer (`OPENAI_RESPONSE_INVALID`) is about the batch, so its commits are retried singly at once. A **transport** failure is not: four more calls into a throttled CLI time out the same way at 120 s each, so those are recorded failed and left to the job's retry profile. Token counts are divided by the number of commits the call answered — the columns are per commit, and writing the call's total on each row would report four times what was spent.
- **The per-commit fan-out is a rolling pool, not `allSettled` over slices** (`analyzeRepo`). A CLI call's latency varies 13.3–29.1 s, measured, so a fixed slice of five idled four slots waiting on its slowest member; a worker that takes the next chunk keeps all five busy to the end of the page, and the abort check moved from per page to per chunk.
- **Commit analysis** (`commit-analysis/`): each non-merge commit's message + diff (capped at 60k chars, or that divided by the batch size) goes to the configured LLM (`OPENAI_COMMIT_ANALYSIS_MODEL` / `GEMINI_COMMIT_ANALYSIS_MODEL`) with a Zod structured output: `commit_type` (`fix|feature|optimization|refactor|docs|test|chore`), `summary`, `changes[]`. Results cached per commit in `github.commit_analyses` with token counts, truncation flag, and status (`analyzed|skipped_merge|skipped_empty|failed`).

### Slack integration (`src/integrations/slack/`)

No OAuth. The user creates a Slack app, grants the bot scopes, and pastes the `xoxb-` token into settings; `SlackInstallationsService.connectToken` validates it with `auth.test` and stores it encrypted in `slack.installations` (one active installation per workspace, partial unique index where `deleted_at IS NULL`). Re-pasting replaces it — rotating a bot token is the normal reason to come back. `SlackClient` wraps `@slack/web-api` (postMessage, paginated channel/member listing, token revoke on disconnect); `auth.revoke` runs only when this row is the last active holder of the Slack team, since it would otherwise kill delivery for another workspace. Required bot scopes are `SLACK_BOT_SCOPES` in `@launchstack/api-interfaces` — one source for the backend and the settings screen.

### Email delivery

Resend is gone; there is no hosted email provider and no verified sending domain to arrange. `BriefEmailService` sends over **SMTP** with the user's own mailbox credentials (a Gmail app password, Fastmail, a company relay) via `nodemailer`, through the single `createTransport` call site in `src/local/settings/smtp.ts`, which sets `secure` on 465 and `requireTLS` on everything else — nodemailer otherwise falls back to plaintext when STARTTLS is missing, which would put the user's mailbox password on the wire. The cost is that a certificate-less localhost/LAN relay now fails instead of silently downgrading. Credentials come from `SecretsService`, read **inside** the send path — nothing is loaded at construction, so booting with no SMTP settings cannot fail.

`PUT /api/local-settings/credentials` runs `transporter.verify()` (connect + AUTH, no message sent) before storing, so a typo'd app password is a red field rather than a failed brief days later.

The brief's HTML is rendered by `BriefRenderService` from the React Email template in `briefs/delivery/` — that is the only React Email left; the auth (OTP, invite) templates went with Better Auth, and `src/emails/` no longer exists.

**A third channel: desktop notification.** `BriefDesktopService` posts `{ type: 'notification', title, body, briefId }` over `process.parentPort` and the Electron main process shows a native notification. It is `@Optional()` in `BriefDelivererService` and gated on a toggle in `local_settings`; outside Electron it fails with "desktop channel unavailable" rather than pretending. A successful desktop send **is** recorded in `delivered_channels`, whose union is `'email' | 'slack' | 'desktop'` in both the DTO and the database types — that is what stops a notification-only delivery from reading as "nothing was sent". What it does not get is a *manual* re-send: `deliverOne` takes `Exclude<BriefDeliveryChannel, 'desktop'>`, since re-notifying the machine the user is already looking at is not a retry.

## Testing

**Unit tests**: `*.spec.ts` under `src/` (convention: colocated `__tests__/` dirs). ESM-only packages don't work with Jest (CJS), so manual mocks in `src/__mocks__/` are wired via `moduleNameMapper` in package.json for: `@octokit/core`, `@octokit/plugin-paginate-rest`, `@slack/web-api`, `nodemailer`, `openai` (+ `/helpers/zod`), `@react-email/render`, `@react-email/components`.

The `openai` mock's `responses.parse` dispatches on the schema name already carried in the request (`commit_analysis` vs `brief_output`), because the two callers' Zod schemas disagree and a commit analysis validated against `BriefOutputSchema` fails. `chat.completions.create` (the Gemini path) dispatches on the same name out of `response_format.json_schema` and answers with a JSON string.

Job handlers and the activities behind them are unit-tested as plain NestJS providers. There is no workflow-orchestration test layer any more — a handler *is* the orchestration, so `commit-analysis.jobs.spec.ts` and `brief.jobs.spec.ts` cover what `@temporalio/testing` used to.

When adding a new ESM-only dependency used in tested code, add a mock + `moduleNameMapper` entry — and the matching `resolve.alias` entry in `vitest.e2e.config.ts`, which is Vitest's equivalent (it does not read `moduleNameMapper`).

**Timezone-sensitive tests** must pin the *process* zone, and `process.env.TZ = …` inside a spec does not do it — under Jest 30 the sandboxed `process.env` never reaches V8's timezone cache, so the assignment silently no-ops and the test runs in the boot zone. Use the 25-line custom environment instead, selected per file by docblock:

```ts
/**
 * @jest-environment <rootDir>/../test/timezone-jest-environment.js
 * @jest-environment-options {"timezone": "America/New_York"}
 */
```

Pick a zone and a date that actually transition, or the test proves nothing — the whole suite passed under `TZ=America/Santiago` while the cadence bug was live. `cadence.service.server-tz-new-york.spec.ts` (gap at 02:00, `2026-03-08`) and `cadence.service.server-tz-santiago.spec.ts` (gap at 00:00, `2026-09-06`) are the worked examples, and each asserts the harness itself first.

**E2E tests** (`test/e2e/`): Vitest, not Jest — the suite renders brief HTML with the real ESM-only `@react-email/render`, which Jest's CJS runtime cannot load. **No Docker, no Postgres server, no network.** Each file builds its own `new PGlite()` with no data directory (`createTestDatabase()`), replays the migration chain, and boots the real `AppModule` with the `KYSELY_DB` token overridden to that instance (`createTestApp(db)`) — an in-memory PGlite lives inside one object, so the harness and the app must share it. Every outbound module is aliased to the same `src/__mocks__/` files Jest uses; `setup-file.ts` sets `globalThis.jest = vi` before they load.

**Close exactly once.** `KyselyModule.onModuleDestroy` destroys the injected handle, so a spec that boots an app calls `testApp.close()` and nothing else; a DB-only spec calls the `close()` from `createTestDatabase()`. Kysely's `destroy()` is not idempotent.

**The job runner and the scheduler are live in every booted e2e app.** Never `sleep()` to wait for background work — poll with `waitForJobs(db)` from `test/e2e/harness/wait-for-jobs.ts`, which drains on the empty table and re-throws a failed job's own error instead of timing out silently. `pipeline.e2e.spec.ts` is the end-to-end example: PAT connect → branch pick → scan/backfill/analyze → project → brief generated and delivered over the mocked SMTP transport.

Config: `vitest.e2e.config.ts`; env: `.env.test`; details: `test/e2e/README.md`.

## API Conventions

- All responses use `ApiResponse<T>` from `@launchstack/api-interfaces`: `{ data, message, success }`. Errors use the `ApiError` shape (`code`, `message`, `details?`) produced by `ApiException`.
- Async work returns **202** with `{ jobId }` (e.g. brief generation, branch setup, collaborator sync).

## Environment Variables

See `.env.example` for the full template. In normal operation **the Electron main process supplies all of these** — it generates `API_TOKEN` and `DB_ENCRYPTION_KEY` on first launch, resolves `DATA_DIR` from `app.getPath('userData')`, and decrypts the rest out of `userData/secrets.bin`. A `.env` is only for headless development.

**Supplied by the shell:**

- `API_TOKEN` — per-boot bearer token for `LocalTokenGuard`. Absent means every request 401s.
- `DATA_DIR` — the PGlite directory's parent (the database lands in `$DATA_DIR/data`). Defaults to `./.data`.
- `DB_ENCRYPTION_KEY` — the passphrase AES-256-GCM keys derive from, protecting the stored GitHub PAT and Slack bot token. Generated once and then **stable**; `SecretsService` falls back to an ephemeral per-boot key with a warning rather than a hardcoded default.
- `FRONTEND_URL` — used to build the "view in app" link in brief emails and Slack posts. Both leaf senders `getOrThrow` it.

**The secret bundle** (all optional — pasted in the settings screen, persisted by the shell, and writable at runtime through `PUT /api/local-settings/credentials`):

- `GITHUB_TOKEN` — the fine-grained PAT. The authoritative copy is the encrypted `github.installations` row; this mirrors it so `GET /api/local-settings` has one source. **Not writable through `PUT /credentials`** — it is written only by `POST /api/integrations/github/token`, which validates the PAT and writes the row ingest actually reads.
- `LLM_PROVIDER` — `openai` (default), `gemini`, `claude-code`, `opencode`, `cursor` or `codex`. Written by the AI page; decides which key and which model vars are read. The four CLIs read no key at all.
- `OPENAI_API_KEY` / `GEMINI_API_KEY` — the selected provider's key is the one that matters; each is shared by commit analysis and brief generation. Only one needs to be set, and a CLI provider needs neither.
- `OPENAI_COMMIT_ANALYSIS_MODEL`, `OPENAI_BRIEF_MODEL` (default `gpt-4o-mini`), `GEMINI_COMMIT_ANALYSIS_MODEL`, `GEMINI_BRIEF_MODEL` (default `gemini-3.1-flash-lite`), `CLAUDE_CODE_COMMIT_ANALYSIS_MODEL` / `CLAUDE_CODE_BRIEF_MODEL` (defaults `haiku` / `sonnet` — aliases or full ids accepted by `claude --model`), `OPENCODE_COMMIT_ANALYSIS_MODEL` / `OPENCODE_BRIEF_MODEL` (both default `opencode/big-pickle` — always `provider/model`, as printed by `opencode models`), and `CURSOR_COMMIT_ANALYSIS_MODEL` / `CURSOR_BRIEF_MODEL` (defaults `composer-2.5-fast` / `composer-2.5` — ids as printed by `agent --list-models`; `auto` is valid). Read live, so a change applies to the next job. Not in the bundle and not settable from the app: `COMMIT_ANALYSIS_LLM_PROVIDER` / `BRIEFS_LLM_PROVIDER`, honoured from env only.
- `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` — email delivery. Host, user and password are all required for the channel to count as configured.
- `SLACK_BOT_TOKEN` — mirrors the encrypted `slack.installations` row, same as `GITHUB_TOKEN`.

**Process timezone:** `TZ`, defaulted to `UTC` by `process.env.TZ ??= 'UTC'` as the first statement of `src/main.ts`. The `auth` schema stores naive `timestamp` columns (see `migrations/00001_init.ts:39-41`), so the pin is the safety net for those; application logic does not depend on it — `CadenceService` is process-zone independent by construction.

**Briefs tuning:** `BRIEFS_DISPATCHER_INTERVAL_SECONDS` (60), `BRIEFS_MAX_PROMPT_CHARS` (30000), `BRIEFS_BACKFILL_MAX_BRIEFS` (100 — a backstop; the binding limit is the 90-day `MAX_HISTORY_DAYS` clamp), `BRIEFS_DISPATCH_BATCH_SIZE` (100), `BRIEFS_PENDING_REAP_MINUTES` (15), `BRIEFS_MAX_SCHEDULES_PER_ORG` (20).

**Logging:** `LOG_LEVEL` (info), `LOG_FILE_PATH` (`$DATA_DIR/logs/app.log`, or `../../logs/app.log` headless), `LOG_FILE_MAX_SIZE` (50M), `LOG_FILE_KEEP_FILES` (7). `pino-http` logs request headers, so `authorization`, `cookie`, `set-cookie` and `x-desktop-token` are redacted; request **bodies** are never serialized, which is what keeps a pasted credential out of the log.

**Gone:** `DATABASE_URL`, `BETTER_AUTH_*`, `GOOGLE_*`, `RESEND_API_KEY`, `GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET`, `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`/`SLACK_REDIRECT_URI`/`SLACK_SCOPES`, `TEMPORAL_*`, `INTERNAL_API_TOKEN`.
