import { Link } from "@tanstack/react-router"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/devsummary/shared/page-header"
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list"
import { GithubPatForm } from "@/components/integrations/github-pat-form"
import { GithubMark } from "@/components/integrations/provider-marks"
import { InstallationRow } from "@/components/integrations/installation-row"
import { IntegrationTabs } from "@/components/integrations/integration-tabs"
import { useGithubInstallations } from "@/hooks/api/use-github-integrations"

export function IntegrationsGithubPage() {
  const query = useGithubInstallations()

  const installations = query.data?.data ?? []
  const totalRepos = installations.reduce((count, item) => {
    return count + item.repositories.length
  }, 0)
  // A repo with no branch is inert — it contributes nothing to briefs. That is
  // invisible on this page unless it is said out loud, and a token's repository
  // access can widen at any time without passing through setup.
  const unconfiguredRepos = installations.reduce((count, item) => {
    return (
      count +
      item.repositories.filter((repo) => repo.branch === null).length
    )
  }, 0)

  const banner =
    unconfiguredRepos > 0 ? (
      <div className="mb-4 flex flex-wrap items-start gap-2 rounded-xl border border-gb-status-at-risk/35 bg-gb-status-at-risk/10 px-4 py-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gb-status-at-risk" />
        <span className="min-w-40 flex-1">
          <strong className="font-semibold">
            <span className="tabular-nums">{unconfiguredRepos}</span>{" "}
            {unconfiguredRepos === 1 ? "repository isn't" : "repositories aren't"}{" "}
            being read.
          </strong>{" "}
          {unconfiguredRepos === 1 ? "It has" : "They have"} no branch selected,
          so {unconfiguredRepos === 1 ? "it contributes" : "they contribute"}{" "}
          nothing to briefs.
        </span>
        <Button asChild size="sm">
          <Link to="/integrations/github/setup">Choose a branch</Link>
        </Button>
      </div>
    ) : null

  // Gated on accounts rather than repositories: a token that saw zero repos
  // still needs its Sync / Disconnect controls reachable.
  if (!query.isPending && installations.length === 0) {
    return (
      <>
        <IntegrationTabs active="github" />
        <div className="flex min-h-[calc(100svh_-_14rem)] flex-col items-center justify-center gap-5">
          <div className="flex size-16 items-center justify-center rounded-2xl border bg-card shadow-e1">
            <GithubMark className="size-8" />
          </div>
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              Connect GitHub
            </h1>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Paste a fine-grained personal access token. DevSummary reads
              commits through your own access — nothing is installed on your
              account and nothing is ever written.
            </p>
          </div>
          <GithubPatForm />
        </div>
      </>
    )
  }

  return (
    <>
      <IntegrationTabs active="github" />
      <PageHeader
        title="GitHub integration"
        description={
          <>
            <span className="tabular-nums">{installations.length}</span>{" "}
            {installations.length === 1 ? "account" : "accounts"} ·{" "}
            <span className="tabular-nums">{totalRepos}</span>{" "}
            {totalRepos === 1 ? "repository" : "repositories"} connected
          </>
        }
      />

      {banner}

      {query.isPending ? (
        <SkeletonList rows={3} rowHeight={72} />
      ) : (
        <div className="flex flex-col gap-3">
          {installations.map((installation, idx) => (
            <InstallationRow
              key={installation.id}
              installation={installation}
              defaultExpanded={idx === 0}
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        To add or remove repositories, widen your token&rsquo;s repository access
        on GitHub and press Sync.
      </p>
    </>
  )
}
