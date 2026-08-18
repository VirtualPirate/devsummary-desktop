# AGENTS.md — `src/temporal/workflows/`

Guidance for Claude Code when working in this directory.

Parent docs: [backend AGENTS.md](../../../AGENTS.md) ("Background jobs (Temporal)" section) and the [root AGENTS.md](../../../../../AGENTS.md) (product spec). This file documents the workflow layer itself.

## What lives here

Temporal **workflow definitions** — pure, deterministic TypeScript loaded into the workflow sandbox by `src/worker.ts`. They orchestrate; they never touch the DB, the network, or NestJS.

| File | Export |
| --- | --- |
| `activity-proxies.ts` | shared `proxyActivities` retry profiles: `standard`, `slow`, `twice`, `once`, `ingest` |
| `noop.workflow.ts` | `NoopWorkflow` |
| `sync-repo-collaborators.workflow.ts` | `SyncRepoCollaboratorsWorkflow` |
| `scan-repository.workflow.ts` | `ScanRepositoryWorkflow` |
| `backfill-commits.workflow.ts` | `BackfillCommitsWorkflow` |
| `ingest-new-commits.workflow.ts` | `IngestNewCommitsWorkflow`, `IngestNewCommitsInput` |
| `sweep-repositories.workflow.ts` | `SweepRepositoriesWorkflow`, `SweepRepositoriesInput` |
| `analyze-repo.workflow.ts` | `AnalyzeRepoWorkflow`, `AnalyzeRepoInput` |
| `generate-brief.workflow.ts` | `GenerateBriefWorkflow` |
| `backfill-briefs.workflow.ts` | `BackfillBriefsWorkflow` |
| `dispatch-due-briefs.workflow.ts` | `DispatchDueBriefsWorkflow` |
| `backfill-loc-stats.workflow.ts` | `BackfillLocStatsWorkflow` |
| `backfill-repo-loc-stats.workflow.ts` | `BackfillRepoLocStatsWorkflow` |
| `index.ts` | barrel re-export — the module `src/worker.ts` registers as `workflowsPath` |
| `__tests__/` | `@temporalio/testing` orchestration tests (`AnalyzeRepoWorkflow`, `GenerateBriefWorkflow`) |

Activity implementations live outside this directory, next to the feature they belong to (`src/briefs/generation/activities/`, `src/integrations/github/**`, `src/queue/`), discovered via the `@Activity('name')` decorator. Their signatures are typed once in `../activities.interface.ts` (`Activities`); that interface is the contract this directory codes against.

## Retry profiles (`activity-proxies.ts`)

Five proxies, each a `proxyActivities<Activities>()` with a fixed `startToCloseTimeout` + `RetryPolicy`. They encode the retry semantics carried over from the pre-Temporal pg-boss job definitions (`maximumAttempts = retryLimit + 1`).

| Proxy | Timeout | `maximumAttempts` | `initialInterval` | Backoff | Used by |
| --- | --- | --- | --- | --- | --- |
| `standard` | 10 min | 4 | 30s | ×2 | per-commit analysis, all three brief activities |
| `slow` | 15 min | 4 | 60s | ×2 | LOC-stats paging, `briefs.planBackfill`, `commits.listSweepTargets` |
| `twice` | 10 min | 3 | 1s | ×2 | `analysis.planRepoAnalysis`, `commits.planIngest` |
| `once` | 5 min | 1 | — | — | `briefs.claimDue`, `noop.run` (no retry) |
| `ingest` | 2 h, heartbeat 5 min | 4 | 30s | ×2 | `commits.backfillFromLatest`, `commits.backfill` |

`briefs.claimDue` deliberately uses `once`: it claims due schedules in a `SELECT … FOR UPDATE` transaction and advances `nextRunAt`, so a retry would race the next Schedule tick rather than help.

`ingest` is the only proxy with a `heartbeatTimeout`, and that is why it exists rather than being folded into `standard`: the two ingestion activities page a whole lookback window in one call (runtime bounded by repository size, not by a fixed slice of work), and they heartbeat per page. Everything on `standard` does not heartbeat and would start failing the moment a `heartbeatTimeout` were added there. With the heartbeat policing progress, `startToCloseTimeout` is only a backstop — under `standard`'s 10 minutes a large enough repository was killed and retried from page 1 forever, never finishing.

## Workflow catalog

### `NoopWorkflow(message: string)`

Smoke test. Calls `noop.run` once, no retry. Started by `POST /api/_internal/queue/noop` (`src/queue/noop.controller.ts`, `x-internal-token`). No search attributes. Use it to verify the worker is polling the task queue.

### `SyncRepoCollaboratorsWorkflow({ repositoryId, trigger, organizationId? })`

Single-activity wrapper over `collaborators.syncRepo`. `trigger` is `'connected' | 'disconnected' | 'webhook' | 'manual'` and is passed through to the activity (it drives whether collaborators are upserted or soft-deleted, and shows up in logs).

Started with `start()` (not deduped — every trigger is meaningful) from:
- `InstallationsService` — on repo connect/disconnect during install-callback and sync reconciliation
- `WebhooksController` — GitHub `member` events
- `POST /api/integrations/github/repositories/:id/collaborators/sync` — manual

Search attributes: `OrganizationId`, `Phase=fetching`.

### `ScanRepositoryWorkflow({ repositoryId, branch, lookbackDays, organizationId? })`

Entry point for **one (repository, branch) pair**, started when that branch becomes tracked — *not* when the repo is connected. Two steps:

1. `commits.backfillFromLatest` (`ingest`) — pulls commits from the GitHub API starting at the newest commit already stored **on that branch**, bounded by `lookbackDays`. Writes each page as it arrives and heartbeats its progress; a retry still restarts from page 1 (no persisted GitHub cursor). Returns `{ inserted, sinceISO }`.
2. If `sinceISO === null` (nothing to analyze) it returns. Otherwise it `startChild`s `AnalyzeRepoWorkflow` with `force: false` and `Phase=analyzing`, under `ParentClosePolicy.ABANDON`.

Started deduped as `scan:<repositoryId>:<branch>` by `RepositoryBranchesService.setBranches` (`POST /api/integrations/github/repositories/branches`), once per selected repository, with the request's `lookbackDays` (30/90, capped by `MAX_HISTORY_DAYS`). Since the choice is write-once and one repository reads one branch, this fires **at most once per repository** — nothing re-scans a repository afterwards except the manual backfill endpoint below. `Phase=fetching` on the parent.

### `BackfillCommitsWorkflow({ repositoryId, branch, sinceISO, organizationId? })`

Single-activity wrapper over `commits.backfill` (`ingest`) — pulls one explicit commit range for one branch from the GitHub API, no analysis fan-out. Started deduped as `backfill:<repositoryId>:<branch>:<sinceDate>` by `POST /api/integrations/github/repositories/:repoId/commits/backfill`, which fans out one workflow per tracked branch (or takes an explicit `branch`). `Phase=fetching`.

Difference from `ScanRepositoryWorkflow`: this one takes an explicit `sinceISO` and stops after ingestion; the scan derives its own window from the latest stored commit and chains analysis.

### `IngestNewCommitsWorkflow(input: IngestNewCommitsInput)`

Every incremental read after the first one. Three steps: `commits.planIngest` (`twice`) → one of two `ingest` reads → `startChild(AnalyzeRepoWorkflow)` (ABANDON, `analyze:<repoId>:<branch>:<runKey>`).

```ts
interface IngestNewCommitsInput {
  repositoryId: string;
  branch: string;
  trigger: 'push' | 'sweep';   // ids and logs only — the work is identical
  runKey: string;              // head sha for a push, run date for a sweep
  shas?: string[];             // what the trigger named; empty for a sweep
  truncated?: boolean;         // the trigger's list is known incomplete
  earliestPushedISO?: string | null;
  organizationId?: string;
}
```

**A `skip` from the plan step ends the run before any GitHub call** — branch not tracked, or every named sha already attributed to it. That gate is what makes the nightly sweep affordable: a quiet repository costs two indexed queries.

Otherwise the plan picks the read:

| `mode` | Meaning | Read |
| --- | --- | --- |
| `resume` | There is a high-water mark on the branch | `commits.backfill` from `min(newest stored, earliest named)` |
| `adopt` | The branch has **nothing** stored | `commits.backfillFromLatest` with `ADOPT_LOOKBACK_DAYS` (30) — the same first read `ScanRepositoryWorkflow` performs |

Adoption is what recovers a branch whose setup scan failed or that was tracked while the worker was down; it is keyed on "nothing stored", **not** on the trigger, because a push at a never-read branch would otherwise store only the commits it named and resume from that mark forever. A `null` window back from the adopt read means GitHub reports no commits at all (an empty repository) — the workflow returns without starting an analysis child, and since nothing was stored it adopts again next sweep.

`ADOPT_LOOKBACK_DAYS` is a workflow constant, not config: nothing has asked to tune it per install, and it stays in replay history. Lift it to config the first time ops needs a different number.

Two callers, one workflow rather than two near-copies, because the work after "what should we fetch" is identical:

| Caller | Workflow id | `runKey` | `shas` |
| --- | --- | --- | --- |
| `GithubWebhooksController` (`push` event) | `push:<repoId>:<branch>:<headSha>` | head sha | from the payload |
| `SweepRepositoriesWorkflow` | `sweep:<repoId>:<branch>:<runDate>` | run date | none |

Both start it **deduped** (`startDeduped` / `startChild` with an explicit id), so a redelivered push and a re-run sweep reuse the existing execution. The child analysis id uses `runKey` rather than `sinceISO`: two runs minutes apart can derive the same window, and a second child with a live id fails the start. `Phase=fetching` on the parent, `analyzing` on the child.

### `SweepRepositoriesWorkflow(input?: SweepRepositoriesInput)`

Nightly catch-up dispatcher. Calls `commits.listSweepTargets` (`slow`) for one page of `PAGE = 200` tracked (repository, branch) pairs across **all** organizations, `startChild`s an `IngestNewCommitsWorkflow` per pair with `trigger: 'sweep'` and `ParentClosePolicy.ABANDON`, then `continueAsNew`s while the activity returns a cursor.

```ts
interface SweepRepositoriesInput {
  cursor?: { repositoryId: string; branch: string } | null; // only set by continue-as-new
  runDate?: string;                                        // stamped by the first page
}
```

Not started from application code — fired by the Temporal **Schedule** `github-sweep-daily` (`../schedules.bootstrap.ts`): cron `55 23 * * *` in `Etc/UTC` (the `SWEEP_CRON`/`SWEEP_TIMEZONE` constants there, not env vars), overlap `SKIP`.

Three details worth keeping:

- **`runDate` comes from the activity, not the workflow.** Workflow code cannot read a clock, and the date is what makes each child's id stable for the night. It is carried across `continueAsNew` so a sweep that crosses midnight on a large install does not split its children across two id namespaces.
- **The cursor is the `(repositoryId, branch)` pair**, not the repository. One repository reads one branch today, but the table is a set on purpose, and a repository-only cursor would skip a second branch that fell on the far side of a page boundary.
- **No search attributes on the sweep itself** — it spans every tenant, like `BackfillLocStatsWorkflow`. Each child carries its own `OrganizationId` plus `Phase=fetching`, which is what keeps the per-org background-jobs toast honest without inventing a fake owner for the sweep.

### `AnalyzeRepoWorkflow(input: AnalyzeRepoInput)`

Fans out per-commit OpenAI analysis. The most involved workflow here.

```ts
interface AnalyzeRepoInput {
  repositoryId: string;
  sinceISO: string;
  force: boolean;
  organizationId?: string;
  cursor?: { authoredAt: string; id: string } | null; // only set by continue-as-new
}
```

Shape:

1. Every run calls `analysis.planRepoAnalysis` on the `twice` proxy for **one page** — `limit: PAGE = 500`, starting `after` the input cursor (`null` on a fresh run). `force: true` re-analyzes already-analyzed commits in that page.
2. Processes the returned IDs in `BATCH = 50` chunks via `Promise.allSettled` on `analysis.analyzeCommit` (`standard` proxy).
3. If the planner returned a `nextCursor`, `continueAsNew` with the same input plus that cursor.

**The cursor is the point.** Carrying the remaining commit IDs instead (the earlier `pendingCommitIds: string[]`) put an unbounded array in the workflow argument, and Temporal caps a payload at 2 MB — a repository with ~6.7k unanalyzed commits crossed the 256 KB warning, ~50k failed outright. Planning now runs once per page instead of once per scan; that is one extra activity call per 500 commits, in exchange for an argument that never grows. `docs/scale-ceilings.md` tracks the rest of this family.

The planner pages by keyset on `(authoredAt, id)` over *every* commit in the window — merges and already-analyzed ones included — so the cursor advances even when a page yields nothing to enqueue, and the chain always terminates.

**`allSettled`, not `all`, is deliberate** (see the comment in the file): one commit exhausting its 4 activity attempts must not abort the rest of the batch, the rest of the run, or the continue-as-new remainder. The activity persists its own per-commit failure (`recordFailed`) before throwing, so a rejected promise here is already durably recorded — nothing is silently dropped.

Started deduped as `analyze:<repoId>:<days>:<force>` by `POST /api/integrations/github/repositories/:repoId/commits/analyze`, and as a child of `ScanRepositoryWorkflow`. `Phase=analyzing`.

Tuning `BATCH`/`PAGE` changes history size and OpenAI concurrency pressure; worker-level caps (`maxConcurrentActivityTaskExecutions`, 20) are the real throughput ceiling.

### `GenerateBriefWorkflow({ briefId, deliver?, organizationId? })`

Generates (and optionally delivers) exactly one brief. All three activities on `standard`. Two early-exit gates:

1. `briefs.markGenerating` → `{ proceed }`. `proceed: false` means the brief is no longer eligible (already generating/generated, or gone) — return without doing anything. This is what makes a duplicate start harmless.
2. `briefs.generateContent` → `{ terminal }`. `terminal: true` means the run finished in a terminal failure (e.g. the scope was deleted) — return **without** delivering.
3. `deliver === false` → return (backfilled briefs never deliver). Note the check is strictly `=== false`, so an omitted `deliver` delivers.
4. `briefs.deliver` — email + Slack, sets brief status `delivered`/`failed`.

Started by: `POST /api/organizations/current/briefs/generate` (`BriefsService`, `deliver` omitted → delivers), and as a child of `DispatchDueBriefsWorkflow` (`deliver: true`) and `BackfillBriefsWorkflow` (`deliver: false`). `Phase=generating`.

### `BackfillBriefsWorkflow({ scheduleId, organizationId? })`

Runs once when a brief schedule is created. Calls `briefs.planBackfill` (`slow` proxy — it can create up to `BRIEFS_BACKFILL_MAX_BRIEFS`, default 100, rows, though the `MAX_HISTORY_DAYS` clamp on the lookback binds first) and then `startChild`s one `GenerateBriefWorkflow` per created brief with `deliver: false`, `ParentClosePolicy.ABANDON`.

Started (fire-and-forget, errors logged not propagated) by `BriefSchedulesService.create`. `Phase=generating` on parent and children.

### `DispatchDueBriefsWorkflow()`

The recurring dispatcher. Calls `briefs.claimDue` on the `once` proxy (no retry — see above), which finds schedules with `nextRunAt <= now` under `SELECT … FOR UPDATE`, inserts pending `briefs` rows, and advances `nextRunAt`. Then `startChild`s a `GenerateBriefWorkflow` per claimed brief with `deliver: true`, `ParentClosePolicy.ABANDON`.

Not started from application code — fired by the Temporal **Schedule** `briefs-dispatch-due`, created idempotently on API boot by `SchedulesBootstrap` (`../schedules.bootstrap.ts`): interval `BRIEFS_DISPATCHER_INTERVAL_SECONDS` (default 60s), overlap policy `SKIP`. Takes no arguments, so it carries **no** `OrganizationId`; each child gets `OrganizationId` from its own brief plus `Phase=generating`.

### `BackfillLocStatsWorkflow()`

System-scoped LOC-stats backfill. Calls `loc.zeroFillAndFindMissing` (`slow`) to zero-fill known-empty rows and return repositories still missing stats, then `startChild`s a `BackfillRepoLocStatsWorkflow` per repository with `cursor: null` and `ParentClosePolicy.ABANDON`.

**Not started from application code.** It used to be started once per worker boot by `src/worker.ts` (deduped on the fixed workflow ID `github.backfill-loc-stats`); that start was removed once the historical backfill had converged. New commits get their LOC stats inline at analysis time (`analysis.analyzeCommit`), so this workflow only matters for another one-off historical fill — start it by hand (`temporal workflow start --type BackfillLocStatsWorkflow --task-queue launchstack --workflow-id github.backfill-loc-stats`) or re-add a start call. **No search attributes** — this is cross-org system work and must not appear in any org's background-jobs toast.

### `BackfillRepoLocStatsWorkflow({ repositoryId, cursor })`

Self-rescheduling pager. Calls `loc.pageRepo` (`slow`) for one page; if it returns a non-null `nextCursor` it `sleep('5s')` (mirroring the old `REQUEUE_DELAY_SECONDS`) and `continueAsNew` with that cursor. A `null` cursor ends the chain. No search attributes.

## Rules when editing this directory

- **No NestJS, no DB, no `fetch`, no `Date.now()`/`Math.random()` in workflow code.** Workflow code is replayed; only activities may be non-deterministic. Non-determinism breaks existing running executions, not just new ones.
- **Changing a workflow's shape is a versioning problem.** Executions in flight replay against the new code. For anything beyond additive optional input fields, use `patched()`/`deprecatePatch` or start a new workflow type.
- **Adding an activity:** add its signature to `../activities.interface.ts`, implement it as an `@Activity('name')` method on a DI provider in the owning feature module, then call it through one of the five proxies. Don't add another one for a one-off timeout — reuse the closest profile unless the difference is real (`ingest` earned its own because a `heartbeatTimeout` cannot be shared with activities that never heartbeat).
- **Adding a workflow:** create the file, export it from `index.ts` (the worker only sees what the barrel exports), and add a key to `../workflow-types.ts` `WORKFLOW` so callers reference the type name through that const rather than a string literal.
- **Search attributes:** org-scoped starts must pass `buildSearchAttributes({ organizationId, phase })` from `../search-attributes.ts` — `JobActivityService` counts Running workflows per phase off these, and the frontend toast reads that. Children started here set their own explicitly. `OrganizationId`/`Phase` must be registered on the namespace or Temporal **rejects the start**; `SchedulesBootstrap` registers them on API boot, with `scripts/register-search-attributes.sh` as manual fallback.
- **`ParentClosePolicy.ABANDON` on every `startChild` here** — parents are dispatchers, not supervisors; a parent completing must not cancel in-flight children.
- **Fan-out uses `Promise.allSettled`** when partial failure is acceptable and the activity records its own failure. Use `Promise.all` only when one failure genuinely should abort the run.
- **Bound history.** Any unbounded fan-out or loop needs `continueAsNew` (see `AnalyzeRepoWorkflow`'s `PAGE`, `BackfillRepoLocStatsWorkflow`'s cursor).
- **Bound the argument too.** `continueAsNew` carrying a list that grows with the data is a payload limit waiting to fire — carry a cursor and re-query, as `AnalyzeRepoWorkflow` does.

## Testing

Orchestration tests use `@temporalio/testing`'s time-skipping `TestWorkflowEnvironment` with mocked activities — they assert control flow (which activities ran, in what order, whether a child started, where `continueAsNew` fires), not business logic.

```bash
cd apps/backend
pnpm test -- --testPathPattern=workflows
```

Current coverage: `GenerateBriefWorkflow` (deliver on/off, empty, scope-deleted), `AnalyzeRepoWorkflow` (fan-out + continue-as-new boundary), and `IngestNewCommitsWorkflow` (resume vs adopt read, skip makes no GitHub call, empty adopted branch starts no analysis child). Note that a test's `runKey` doubles as the analysis child's workflow id, so each case needs its own or the second fails with `WorkflowExecutionAlreadyStartedError`. Activity business logic is unit-tested separately as plain NestJS providers (e.g. `src/briefs/generation/activities/brief.activities.spec.ts`).

Run the worker locally with `pnpm start:worker:dev` (the API process runs no worker) and watch executions in the Temporal UI at http://localhost:8080.
