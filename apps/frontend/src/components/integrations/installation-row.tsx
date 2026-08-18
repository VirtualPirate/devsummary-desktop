import type { GithubInstallationWithRepos } from "@launchstack/api-interfaces"
import { Link } from "@tanstack/react-router"
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Lock,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { colorFromString } from "@/lib/entity-color"
import { cn } from "@/lib/utils"
import { useSyncGithubInstallation } from "@/hooks/api/use-github-integrations"
import { DisconnectInstallationDialog } from "./disconnect-installation-dialog"

type Props = {
  installation: GithubInstallationWithRepos
  defaultExpanded?: boolean
}

function IdentityAvatar({
  seed,
  label,
  className,
}: {
  seed: string
  label?: string
  className?: string
}) {
  const initial = (label ?? seed).trim().charAt(0).toUpperCase() || "?"
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center font-bold text-white",
        className,
      )}
      style={{ background: colorFromString(seed) }}
    >
      {initial}
    </span>
  )
}

export function InstallationRow({ installation, defaultExpanded }: Props) {
  const [expanded, setExpanded] = useState(!!defaultExpanded)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const syncMutation = useSyncGithubInstallation()

  const configureUrl =
    installation.accountType === "Organization"
      ? `https://github.com/organizations/${installation.accountLogin}/settings/installations/${installation.githubInstallationId}`
      : `https://github.com/settings/installations/${installation.githubInstallationId}`

  const repoCount = installation.repositories.length
  const unconfiguredCount = installation.repositories.filter(
    (repo) => repo.branch === null,
  ).length

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <IdentityAvatar
            seed={installation.accountLogin}
            className="size-9 rounded-xl text-sm"
          />
          <span className="min-w-0">
            <span className="block truncate font-semibold">
              {installation.accountLogin}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {installation.accountType} ·{" "}
              <span className="tabular-nums">{repoCount}</span>{" "}
              {repoCount === 1 ? "repository" : "repositories"}
              {unconfiguredCount > 0 ? (
                <>
                  {" · "}
                  <span className="tabular-nums">{unconfiguredCount}</span> not
                  configured
                </>
              ) : null}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <a href={configureUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              Configure
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => syncMutation.mutate(installation.id)}
            disabled={syncMutation.isPending}
          >
            <RefreshCw
              className={cn("size-3.5", syncMutation.isPending && "animate-spin")}
            />
            {syncMutation.isPending ? "Syncing…" : "Sync"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDisconnectOpen(true)}
          >
            <Trash2 className="size-3.5" />
            Disconnect
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t p-4">
          {repoCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              No repositories yet — use Configure to add some on GitHub.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {installation.repositories.map((repo) => (
                <div
                  key={repo.id}
                  className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2"
                >
                  <IdentityAvatar
                    seed={repo.fullName}
                    label={repo.name}
                    className="size-7 rounded-lg text-[0.7rem]"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {repo.fullName}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {repo.private ? (
                      <>
                        <Lock className="size-3" />
                        Private
                      </>
                    ) : (
                      "Public"
                    )}
                  </span>
                  {repo.branch ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 font-mono text-xs"
                      title="Branch selection can't be changed yet"
                    >
                      <GitBranch className="size-3" />
                      {repo.branch}
                    </span>
                  ) : (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-6 shrink-0 border-brand px-2 text-xs text-brand"
                    >
                      <Link to="/integrations/github/setup">
                        <GitBranch className="size-3" />
                        Choose a branch
                      </Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <DisconnectInstallationDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        installationId={installation.id}
        accountLogin={installation.accountLogin}
      />
    </Card>
  )
}
