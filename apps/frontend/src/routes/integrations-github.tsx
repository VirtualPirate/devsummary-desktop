import { Link, useSearch } from "@tanstack/react-router"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConnectReposGate } from "@/components/devsummary/shared/connect-repos-gate"
import { PageHeader } from "@/components/devsummary/shared/page-header"
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list"
import { ConnectGithubButton } from "@/components/integrations/connect-github-button"
import { InstallationRow } from "@/components/integrations/installation-row"
import { IntegrationTabs } from "@/components/integrations/integration-tabs"
import { useGithubInstallations } from "@/hooks/api/use-github-integrations"

/**
 * The install callback redirects here with `?error=<AppError code>`, so the raw
 * code would otherwise land in front of the user. "Try connecting again" is only
 * the right advice for the transient cases.
 */
const CALLBACK_ERRORS: Record<string, string> = {
  GITHUB_INSTALLATION_ALREADY_CONNECTED:
    "That GitHub account is already connected to another organization. Disconnect it there first, then connect it here. The GitHub App stays installed on the account in the meantime.",
  GITHUB_STATE_INVALID:
    "That install link expired. Start the connection again from this page.",
  GITHUB_STATE_USER_MISMATCH:
    "That install link belongs to a different user. Start the connection again from this page.",
  GITHUB_APP_NOT_CONFIGURED:
    "The GitHub App isn't configured on this server yet. Contact your administrator.",
}

const FALLBACK_CALLBACK_ERROR =
  "We couldn't connect GitHub. Try connecting again."

export function IntegrationsGithubPage() {
  const query = useGithubInstallations()
  // No `connected` here: a successful install now lands on
  // /integrations/github/setup, which owns the "connected, nothing read yet"
  // message. Only the failure path redirects back to this page.
  const search = useSearch({ strict: false }) as { error?: string }

  const installations = query.data?.data ?? []
  const totalRepos = installations.reduce((count, item) => {
    return count + item.repositories.length
  }, 0)
  // A repo with no branch is inert — it contributes nothing to briefs. That is
  // invisible on this page unless it is said out loud, and GitHub's own
  // "Configure" flow can add repos at any time without passing through setup.
  const unconfiguredRepos = installations.reduce((count, item) => {
    return (
      count +
      item.repositories.filter((repo) => repo.branch === null).length
    )
  }, 0)

  /**
   * Rendered in both branches — a failed install callback must stay visible even
   * when the takeover replaces the rest of the page.
   */
  const banners = (
    <>
      {search.error ? (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {CALLBACK_ERRORS[search.error] ?? FALLBACK_CALLBACK_ERROR}
        </div>
      ) : null}
      {unconfiguredRepos > 0 ? (
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
      ) : null}
    </>
  )

  // Gated on accounts rather than repositories: an installation that synced zero
  // repos still needs its Configure / Disconnect controls reachable.
  if (!query.isPending && installations.length === 0) {
    return (
      <>
        <IntegrationTabs active="github" />
        {banners}
        <ConnectReposGate />
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
        actions={<ConnectGithubButton />}
      />

      {banners}

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
        To add or remove repositories, use Configure on an account — it opens
        that installation&rsquo;s settings on GitHub.
      </p>
    </>
  )
}
