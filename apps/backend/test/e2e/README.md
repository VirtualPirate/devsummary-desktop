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
`@octokit/core`, `@octokit/plugin-paginate-rest`, `@slack/web-api`,
`nodemailer`, `openai`, `openai/helpers/zod`. An alias is Vitest's equivalent
of `moduleNameMapper` (which it does not read) and needs no DI override, so the
app's own wiring stays under test. The aliases are anchored regexes, not bare
strings: a string alias for `openai` is a prefix match and would rewrite
`openai/helpers/zod` into a path inside the mock file.

Those mocks are written against the `jest` global, so `setup-file.ts` sets
`globalThis.jest = vi` before anything loads them.

`@react-email/*` is deliberately **not** aliased — brief HTML is rendered for
real. `smoke.e2e.spec.ts` asserts both halves of this: real react-email, and a
`__reset` static on all four mocked clients (which fails the moment an alias
stops matching and a real, network-capable client is loaded instead).

## JSX in the email templates

`vitest.e2e.config.ts` sets swc's `jsc.transform.react.runtime: 'automatic'`
explicitly. unplugin-swc reads this package's `tsconfig.json` for decorators
and target, but does **not** translate its `jsx: react-jsx` into swc's
automatic runtime. Without the override, `src/emails/*.tsx` compile to bare
`React.createElement` and every render fails with `React is not defined`.

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
