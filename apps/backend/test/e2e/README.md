# E2E integration tests

Real Postgres, real Temporal, real Better Auth. Run with `pnpm test:e2e` from
`apps/backend/`. **Docker must be running.**

Filter a single file with
`pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/specs/<file>`.

## What is real and what is not

Exactly one module is mocked: `resend`. `new Resend(...)` is called directly at
five non-injectable sites, so it is mocked at the module level in
`setup-file.ts` rather than through Nest DI — and stays correct when a sixth
appears.

Everything else runs for real — Better Auth (including its own Kysely/pg
stack), `OrgContextGuard`, `AllExceptionsFilter`, `RequestIdMiddleware`, and
`@react-email/render`.

Google OAuth is disabled rather than mocked: `.env.test` sets
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` empty, so `auth.config.ts` omits
`socialProviders`. GitHub, OpenAI, and Slack need no handling — their modules
already provide rejecting stubs when their env vars are absent.

## Two pools per app

`createAuth()` builds Better Auth its own `pg.Pool` (`search_path=auth`).
`KyselyModule.onModuleDestroy` destroys only the application pool, so
`app.close()` alone leaks up to 10 sockets per boot and Vitest reports a
hanging process. `createTestApp().close()` ends both. **If the process stops
exiting cleanly, check that first** — it is not a Vitest configuration problem.

## JSX in the email templates

`vitest.e2e.config.ts` sets swc's `jsc.transform.react.runtime: 'automatic'`
explicitly. unplugin-swc reads this package's `tsconfig.json` for decorators
and target, but does **not** translate its `jsx: react-jsx` into swc's
automatic runtime. Without the override, `src/emails/*.tsx` compile to bare
`React.createElement` and every send fails with `React is not defined` —
which surfaces as an empty `capturedEmails` array, not as an obvious build
error.

## Why this directory has its own tsconfig

`test/e2e/tsconfig.json` overrides `module` to `esnext`. The package tsconfig
targets `nodenext`/CommonJS, under which `import.meta` is an error and relative
imports demand `.js` extensions — both wrong for files that only ever run as
ESM through swc. Nothing compiles this directory with tsc; the override exists
so editors and a manual `tsc --noEmit` agree with how the code actually runs.

## Lifecycle

- **Once per run** (`global-setup.ts`): start `postgres:18` with
  `max_connections=300`, create `e2e_template`, run `kysely migrate:latest`
  into it, start a Temporal CLI dev server with `OrganizationId` and `Phase`
  registered as search attributes.
- **Once per worker** (`setup-file.ts`): load `.env.test`, apply the injected
  Postgres and Temporal addresses, install the `resend` mock.
- **Once per file** (`createFileDatabase()`): `CREATE DATABASE … TEMPLATE
  e2e_template`, a near-instant file copy, then point `DATABASE_URL` at it and
  return a `Kysely<Database>` configured like the application's.

## Writing a new spec

1. `beforeAll`: call `createFileDatabase()` **first**, then any `process.env`
   mutation the file needs, then `createTestApp()`.
2. `afterAll`: `await testApp.close()` then `await closeDb()`.
3. Use lowercase emails. Better Auth builds the OTP identifier as
   `${type}-otp-${email}` with the email exactly as supplied.
4. Query with the returned Kysely instance — camelCase, schema-qualified keys
   (`auth.user`, `organizationMembers`). `CamelCasePlugin` handles the SQL.
5. `count(*)` is `int8`, and `kysely.module.ts` sets a process-wide `pg` parser
   mapping `int8` to `BigInt`. Cast `::int` or wrap in `Number()`.

## Reading OTPs

Do not try to intercept email. `readOtp()` reads the code out of
`auth.verification` — the same row the verify endpoint checks against.

## Known limits

- Parallel files share one Temporal server and the `default` namespace.
  Auto-generated workflow IDs will not collide, but `startDeduped()` uses
  caller-supplied IDs that could. The first suite to use it must namespace its
  IDs per file.
- No worker consumes the task queue, so workflows the API starts stay in
  Scheduled state. That is the correct assertion for "did this endpoint enqueue
  work". Add a worker when a suite needs real execution.
- OTP rows expire after 300s. Irrelevant at test speed; a paused debugger will
  expire one.
- `seedMember()` can only seed `owner` on an org that has none —
  `migrations/00005_organization_single_owner` allows one owner row per
  organization.
- `DELETE /api/organizations/current` runs `OrganizationTeardownService`, which
  queries and terminates the org's workflows on the real Temporal server. It
  swallows its own failures, so it never fails the delete.
- First run downloads the `postgres:18` image and the Temporal dev server
  binary, and needs network access.
