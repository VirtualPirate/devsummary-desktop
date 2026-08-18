import type {
  GithubLookbackDays,
  GithubRepository,
  RepositoryBranchSelection,
} from "@launchstack/api-interfaces"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { CheckCircle2, ChevronRight, GitBranch, Lock } from "lucide-react"
import { useState } from "react"
import { ConnectReposGate } from "@/components/devsummary/shared/connect-repos-gate"
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list"
import { BranchSetupList } from "@/components/integrations/branch-setup-list"
import { historyWindowLabel } from "@/lib/history-window"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { extractErrorMessage } from "@/lib/extract-error"
import {
  useGithubInstallations,
  useSetRepositoryBranches,
} from "@/hooks/api/use-github-integrations"
import { useCurrentOrganization } from "@/hooks/api/use-organizations"

const STEPS = ["Connect", "Choose a branch", "Schedule"] as const

function Steps() {
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-2">
          <span className={i === 1 ? "font-semibold text-foreground" : undefined}>
            {i + 1} · {step}
          </span>
          {i < STEPS.length - 1 ? <ChevronRight className="size-3.5" /> : null}
        </li>
      ))}
    </ol>
  )
}

function Centered({
  icon,
  title,
  body,
  actions,
}: {
  icon: React.ReactNode
  title: string
  body: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      {icon}
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      {actions ? <div className="mt-2 flex gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * Post-connect branch setup. The install callback redirects here, because a
 * freshly connected repository has no branch and therefore ingests nothing until
 * one is chosen — this screen is where that choice happens, for every repository
 * still waiting, in one pass.
 */
export function IntegrationsGithubSetupPage() {
  const installationsQuery = useGithubInstallations()
  const currentOrg = useCurrentOrganization()
  const setBranches = useSetRepositoryBranches()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { connected?: string }

  const [started, setStarted] = useState<{
    repositories: Array<{ fullName: string; branch: string }>
    lookbackDays: GithubLookbackDays
  } | null>(null)

  const installations = installationsQuery.data?.data ?? []
  const pending: GithubRepository[] = installations.flatMap((installation) =>
    installation.repositories.filter((repo) => repo.branch === null),
  )

  const callerRole = currentOrg.data?.data.role
  // Same freshness rule as the members page: `!== "viewer"` is briefly true while
  // the org refetches after a switch, which would flash the form at a viewer.
  const canConfigure = callerRole === "owner" || callerRole === "admin"

  const handleSubmit = (payload: {
    lookbackDays: GithubLookbackDays
    selections: RepositoryBranchSelection[]
  }) => {
    const byId = new Map(pending.map((repo) => [repo.id, repo]))
    setBranches.mutate(payload, {
      onSuccess: () => {
        setStarted({
          lookbackDays: payload.lookbackDays,
          repositories: payload.selections.map((selection) => ({
            fullName:
              byId.get(selection.repositoryId)?.fullName ??
              selection.repositoryId,
            branch: selection.branch,
          })),
        })
      },
    })
  }

  if (installationsQuery.isPending || currentOrg.isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <Steps />
        <SkeletonList rows={4} rowHeight={64} />
      </div>
    )
  }

  if (installations.length === 0) {
    return <ConnectReposGate />
  }

  if (started) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-gb-status-shipped/30 bg-gb-status-shipped/10 px-4 py-3 text-sm font-medium text-gb-status-shipped">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          Started — we&rsquo;re reading{" "}
          {historyWindowLabel(started.lookbackDays).toLowerCase()} of history for{" "}
          <span className="tabular-nums">{started.repositories.length}</span>{" "}
          {started.repositories.length === 1 ? "repository" : "repositories"}.
          This keeps running if you leave.
        </div>
        <Card className="gap-0 overflow-hidden py-0">
          {started.repositories.map((repo) => (
            <div
              key={repo.fullName}
              className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {repo.fullName}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs">
                <GitBranch className="size-3.5" />
                {repo.branch}
              </span>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 border-t px-4 py-4">
            <span className="flex-1 text-xs text-muted-foreground">
              Fetching and analysis run in the background — progress shows in the
              activity indicator.
            </span>
            <Button asChild variant="outline">
              <Link to="/integrations/github">GitHub integration</Link>
            </Button>
            <Button asChild>
              <Link to="/schedules/new">Set up a schedule</Link>
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  if (!canConfigure) {
    return (
      <div className="mx-auto max-w-3xl">
        <Centered
          icon={<Lock className="size-6 text-muted-foreground" />}
          title="Admins choose which branch we read"
          body={
            pending.length > 0 ? (
              <>
                <span className="tabular-nums">{pending.length}</span>{" "}
                {pending.length === 1 ? "repository is" : "repositories are"}{" "}
                waiting for a branch. Ask an owner or admin of{" "}
                <b>{currentOrg.data?.data.organization.name}</b> to finish setup.
              </>
            ) : (
              "Every connected repository is already being read."
            )
          }
          actions={
            <Button asChild variant="outline">
              <Link to="/">Back to dashboard</Link>
            </Button>
          }
        />
      </div>
    )
  }

  if (pending.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <Centered
          icon={<CheckCircle2 className="size-6 text-gb-status-shipped" />}
          title="All repositories have a branch"
          body={
            <>
              Nothing waiting.{" "}
              <span className="tabular-nums">
                {installations.reduce(
                  (count, item) => count + item.repositories.length,
                  0,
                )}
              </span>{" "}
              connected repositories are being read.
            </>
          }
          actions={
            <>
              <Button asChild>
                <Link to="/schedules/new">Set up a schedule</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/integrations/github">GitHub integration</Link>
              </Button>
            </>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Steps />
      {search.connected ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-gb-status-shipped/30 bg-gb-status-shipped/10 px-4 py-3 text-sm font-medium text-gb-status-shipped">
          <CheckCircle2 className="size-4 shrink-0" />
          GitHub connected — <span className="tabular-nums">{pending.length}</span>{" "}
          {pending.length === 1 ? "repository" : "repositories"} synced. Nothing
          is being read yet.
        </div>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-tight">
        Which branch should we read?
      </h1>
      <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
        DevSummary reads commits from one branch per repository. We&rsquo;ve
        pre-selected each repo&rsquo;s default branch; change it or skip a
        repository for now. Nothing is fetched until you start, and once a
        repository is started its branch is fixed — changing it isn&rsquo;t
        supported yet.
      </p>

      {setBranches.isError ? (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {extractErrorMessage(setBranches.error)}
        </div>
      ) : null}

      <div className="mt-5">
        <BranchSetupList
          repositories={pending}
          isSubmitting={setBranches.isPending}
          onSubmit={handleSubmit}
          onSkip={() => void navigate({ to: "/integrations/github" })}
        />
      </div>
    </div>
  )
}
