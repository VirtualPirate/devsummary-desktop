# E2E integration tests

Real NestJS app, real migrations, real PGlite. Run with `pnpm test:e2e` from
`apps/backend/`. **No Docker, no Postgres server, no network.**

Filter a single file with
`pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/specs/<file>`.

## The database

`createTestDatabase()` builds `new PGlite()` with **no data directory** — the
whole database lives in WASM memory — wires it to Kysely exactly as
`kysely.module.ts` does (PGlite dialect, `CamelCasePlugin`, int8 → BigInt), and
replays the migration chain into it (~1.2 s for all 16).

There is no `globalSetup` and no template database. An in-memory instance
cannot be shared across processes — `globalSetup` can only hand workers
serialisable values — so each file migrates its own, which is still cheaper
than the `postgres:18` testcontainer this replaces.

`createTestApp(db)` boots the real `AppModule` with the `KYSELY_DB` token
**overridden** to that instance. The override is the whole mechanism: an
in-memory PGlite lives inside one object, so the harness and the app have to
share it or they would see two empty, unrelated databases. Everything else —
migrations at boot, the job runner, the scheduler, both global guards — runs
untouched.

**Close exactly once.** `KyselyModule.onModuleDestroy` destroys the injected
handle, so a spec that boots an app calls `testApp.close()` and nothing else. A
spec that never boots one calls the `close()` from `createTestDatabase()`.

## Auth

There is none. The seed migration (`00016_seed_local_singleton`) creates one
`auth.user` and one organization ("My Workspace"), `LocalSessionMiddleware`
puts that user on every request, and `LocalTokenGuard` requires the
`x-desktop-token` header to match `API_TOKEN` on everything outside
`/api/health*`.

Use the `api(server, organizationId?)` helper from `harness/api.ts`: it sets
the token on every request and the workspace header when you pass one. Omit
`organizationId` to exercise `OrgContextGuard`'s fallback to `LOCAL_ORG_ID`.
Use bare `request(server)` only when the point of the test is a *missing*
token.

Roles still work (docs/DELTAS.md D-A), so role tests demote the local user's
membership row inside a scratch workspace — there is nobody else to be.

## What is mocked

Every outbound network module, aliased in `vitest.e2e.config.ts` to the same
`src/__mocks__/` files Jest loads through `moduleNameMapper`:
`@octokit/core`, `@octokit/plugin-paginate-rest`, `openai`,
`openai/helpers/zod`. `node:child_process` is aliased too, to
`test/e2e/fakes/child-process.ts` rather than a Jest mock — the agent CLIs
spawn locally, not over the network. An alias is Vitest's equivalent
of `moduleNameMapper` (which it does not read) and needs no DI override, so the
app's own wiring stays under test. The aliases are anchored regexes, not bare
strings: a string alias for `openai` is a prefix match and would rewrite
`openai/helpers/zod` into a path inside the mock file.

Those mocks are written against the `jest` global, so `setup-file.ts` sets
`globalThis.jest = vi` before anything loads them.

`smoke.e2e.spec.ts` asserts a `__reset` static on every mocked client, which
fails the moment an alias stops matching and a real, network-capable client is
loaded instead. The same test asserts `__setExecFile` on `node:child_process`,
which fails the moment that alias stops matching and the real `execFile` —
able to run any binary on the machine — is loaded instead.

### The fakes layer

The aliases above stub the *modules*. `test/e2e/fakes/` is what makes them
answer something: one file per outbound seam, each exporting an `installX()`
that returns seeding and failure knobs plus a recorder.

| Fake | Seam | Install before |
|---|---|---|
| `github.ts` | `Octokit.request` / `paginate.iterator` | `createTestApp` |
| `llm.ts` | the `openai` SDK — both providers share it | `createTestApp` |
| `agent-cli.ts` | `node:child_process` + a temp PATH directory | `createTestApp` |
| `shell.ts` | `process.parentPort` | any time |

`installFakes()` in `fakes/index.ts` installs all five at once.

`world.ts` holds the one fixture declaration. `seedWorld(server, db, world)`
brings the app to "connected, tracked and ingested" by driving the real
endpoints — not by INSERTing rows, so it cannot disagree with the schema the
app owns.

The GitHub fake is a route table over the seven routes the client actually
calls, and **throws on an unknown route**. A silent `{}` is how a wrong
assertion passes, so a new route is a loud failure naming itself.

### The agent CLI seam

`node:child_process` is aliased to `fakes/child-process.ts`, which re-exports
the real module and overrides only `execFile`. `run-cli.ts` therefore stays
under test: its credential stripping (`childEnv` deletes every `SECRET_KEYS`
entry before the child sees the environment), its stdin write, its timeout and
its kill-grace are real behaviour, and `llm-providers.e2e.spec.ts` asserts on
them.

The fake imports the bare specifier `child_process`; the alias is anchored to
`^node:child_process$` and does not match it, so there is no recursion.

`AgentCliDetector.locate()` walks `process.env.PATH` with `access(X_OK)` before
it falls back to a login-shell probe, so `agent-cli.ts` writes executable stub
files into a temp directory and **isolates PATH to that directory alone**
(`process.env.PATH = dir + delimiter`). Prepending the stub dir over the real
PATH would still find this machine's real `claude`/`opencode`/`agent`/`codex`
binaries, because `locate()` checks `access(X_OK)` before it ever calls
`execFile`. Teardown restores the original PATH. The login-shell fallback
(`$SHELL -lic "command -v <binary>"`) is answered "not found" by the stub, so
PATH is the only thing that decides what is installed. Those files are never
executed — the alias intercepts every spawn. The detector caches a status for
60 s, so a spec that installs or removes a binary mid-file must re-read with
`GET /api/local-settings/agents?refresh=1`.

### The desktop shell

`parentPort()` reads `process.parentPort` at call time and returns null under
plain node, so the desktop notification channel needs no alias — `shell.ts`
assigns the property and deletes it again. Without it, a spec only ever
exercises the channel's *failure* path, which is what every file that does not
install it is doing.

## Why this directory has its own tsconfig

`test/e2e/tsconfig.json` overrides `module` to `esnext`. The package tsconfig
targets `nodenext`/CommonJS, under which `import.meta` is an error and relative
imports demand `.js` extensions — both wrong for files that only ever run as
ESM through swc. `tsc --noEmit -p test/e2e/tsconfig.json` is clean.

## Writing a new spec

1. `beforeAll`: `createTestDatabase()` first, then any `process.env` mutation
   the file needs, then `createTestApp(db)`.
2. `afterAll`: one close — see above.
3. Query with the returned Kysely instance — camelCase, schema-qualified keys
   (`auth.user`, `organizationMembers`). `CamelCasePlugin` handles the SQL.
4. `count(*)` is `int8` and the instance parses int8 as `BigInt`. Cast `::int`
   or wrap in `Number()`.

## Known limits

- Each file gets its own database, so nothing is shared and nothing needs
  namespacing — but a file's specs run in order against one instance, and the
  suites here rely on that.
- The job runner and the scheduler are live in every booted app, so background
  work starts on its own and finishes on its own schedule. **Never `sleep()` to
  wait for it** — use `waitForJobs(db)` from `harness/wait-for-jobs.ts`, which
  polls until the `jobs` table is empty (the runner deletes a job row on
  success) and re-throws a failed job's own error instead of timing out
  silently. `specs/pipeline.e2e.spec.ts` is the worked example.
- The boot sweep finds no tracked branches in most files and stops at one
  indexed query. `pipeline.e2e.spec.ts` does seed one, so its sweep enqueues
  real ingest work against the mocked Octokit — which is the point of it.
- `organization_members` has no `updated_at` column. Do not add one to a `set()`.
- `DELETE /api/organizations/current` runs `OrganizationTeardownService`, which
  swallows its own integration failures, so it never fails the delete.
- A spec that installs a fake must do it in `beforeAll` **before** `createTestApp(db)`, or the app builds a client against an un-stubbed module.
