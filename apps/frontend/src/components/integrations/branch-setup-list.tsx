import type {
  GithubLookbackDays,
  GithubRepository,
  RepositoryBranchSelection,
} from "@launchstack/api-interfaces"
import { AlertTriangle, GitBranch, Globe, Lock, RefreshCw } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { colorFromString } from "@/lib/entity-color"
import { extractErrorMessage } from "@/lib/extract-error"
import { cn } from "@/lib/utils"
import { useRepositoryBranchesBatch } from "@/hooks/api/use-github-integrations"
import { BranchPicker } from "./branch-picker"
import { historyWindowLabel } from "@/lib/history-window"
import { HistoryWindowPicker } from "./history-window-picker"

type Props = {
  repositories: GithubRepository[]
  isSubmitting: boolean
  onSubmit: (payload: {
    lookbackDays: GithubLookbackDays
    selections: RepositoryBranchSelection[]
  }) => void
  onSkip: () => void
}

function RepoAvatar({ fullName, name }: { fullName: string; name: string }) {
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-lg text-[0.7rem] font-bold text-white"
      style={{ background: colorFromString(fullName) }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}

/**
 * The consent gate: nothing is fetched or analyzed until Start is pressed.
 *
 * One repository reads one branch. Selections are *derived* — an untouched row
 * falls back to the default branch from its query, and a touched row is stored
 * as an override — so a late-arriving branch list can still prefill rows without
 * an effect racing the user's click.
 */
export function BranchSetupList({
  repositories,
  isSubmitting,
  onSubmit,
  onSkip,
}: Props) {
  const [lookbackDays, setLookbackDays] = useState<GithubLookbackDays>(90)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [skipped, setSkipped] = useState<Record<string, true>>({})

  const repoIds = useMemo(() => repositories.map((r) => r.id), [repositories])
  const branchQueries = useRepositoryBranchesBatch(repoIds)

  const rows = repositories.map((repo, index) => {
    const query = branchQueries[index]
    const data = query?.data?.data
    const branches = data?.branches ?? []
    const defaultBranch = data?.defaultBranch ?? null
    // An empty repository has no branches at all — nothing to read, so it is
    // never includable and never counted in the Start button.
    const hasBranches = branches.length > 0
    const fallback = branches.find((b) => b.isDefault)?.name ?? defaultBranch
    const selected = overrides[repo.id] ?? fallback
    const included = hasBranches && !skipped[repo.id] && !!selected

    return {
      repo,
      query,
      branches,
      defaultBranch,
      truncated: data?.truncated ?? false,
      isLoading: query?.isPending ?? true,
      isError: query?.isError ?? false,
      errorMessage: query?.error ? extractErrorMessage(query.error) : undefined,
      hasBranches,
      selected,
      included,
    }
  })

  const selections = rows
    .filter((row) => row.included)
    .map((row) => ({ repositoryId: row.repo.id, branch: row.selected as string }))
  const failedCount = rows.filter((row) => row.isError).length
  const stillLoading = rows.some((row) => row.isLoading)

  const useDefaultForAll = () => {
    setSkipped({})
    setOverrides((prev) => {
      const next = { ...prev }
      for (const row of rows) {
        if (row.defaultBranch) next[row.repo.id] = row.defaultBranch
      }
      return next
    })
  }

  const selectBranch = (repositoryId: string, branch: string) => {
    setOverrides((prev) => ({ ...prev, [repositoryId]: branch }))
    // Choosing a branch is also how a skipped row comes back.
    setSkipped((prev) => {
      const next = { ...prev }
      delete next[repositoryId]
      return next
    })
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/50 px-4 py-2.5 text-sm text-muted-foreground">
        <span>
          <span className="font-semibold tabular-nums text-foreground">
            {selections.length}
          </span>{" "}
          of <span className="tabular-nums">{repositories.length}</span>{" "}
          {repositories.length === 1 ? "repository" : "repositories"} will be
          analyzed
        </span>
        <span className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={useDefaultForAll}
            disabled={isSubmitting || stillLoading}
          >
            <GitBranch className="size-3.5" />
            Use default branch for all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setSkipped(
                Object.fromEntries(repoIds.map((id) => [id, true as const])),
              )
            }
            disabled={isSubmitting}
          >
            Skip all
          </Button>
        </span>
      </div>

      {rows.map((row) => (
        <div
          key={row.repo.id}
          className={cn(
            "flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0",
            !row.included && "opacity-60",
          )}
        >
          <Checkbox
            checked={row.included}
            disabled={!row.hasBranches || isSubmitting}
            aria-label={`Analyze ${row.repo.fullName}`}
            onCheckedChange={(checked) =>
              setSkipped((prev) => {
                const next = { ...prev }
                if (checked) delete next[row.repo.id]
                else next[row.repo.id] = true
                return next
              })
            }
          />
          <RepoAvatar fullName={row.repo.fullName} name={row.repo.name} />

          <span className="min-w-0 flex-1 basis-40">
            <span className="block truncate text-sm font-medium">
              {row.repo.fullName}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {row.repo.private ? (
                <Lock className="size-3" />
              ) : (
                <Globe className="size-3" />
              )}
              {row.isLoading ? (
                <Skeleton className="h-3 w-28" />
              ) : row.isError ? (
                <span className="text-destructive">
                  Couldn&rsquo;t load branches — {row.errorMessage}
                </span>
              ) : row.hasBranches ? (
                <>
                  <span className="tabular-nums">{row.branches.length}</span>{" "}
                  {row.branches.length === 1 ? "branch" : "branches"}
                  {row.defaultBranch ? (
                    <>
                      {" · default "}
                      <span className="font-mono">{row.defaultBranch}</span>
                    </>
                  ) : null}
                </>
              ) : (
                <span>No commits yet — nothing to analyze</span>
              )}
            </span>
          </span>

          <span className="ml-auto w-full sm:w-auto">
            {row.isError ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void row.query?.refetch()}
              >
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
            ) : (
              <BranchPicker
                branches={row.branches}
                truncated={row.truncated}
                isLoading={row.isLoading}
                value={row.selected ?? null}
                onSelect={(branch) => selectBranch(row.repo.id, branch)}
                disabled={isSubmitting}
              />
            )}
          </span>
        </div>
      ))}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-card/90 px-4 py-4 backdrop-blur">
        <span className="order-last w-full text-xs text-muted-foreground sm:order-none sm:w-auto sm:flex-1">
          History: <b>{historyWindowLabel(lookbackDays).toLowerCase()}</b>{" "}
          <HistoryWindowPicker
            value={lookbackDays}
            onChange={setLookbackDays}
            disabled={isSubmitting}
          />
          <span className="mt-1 flex items-center gap-1.5">
            <Lock className="size-3" />
            One branch per repository, and the choice is permanent for now — you
            can&rsquo;t change it afterwards.
          </span>
          {failedCount > 0 ? (
            <span className="mt-1 flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="size-3.5" />
              <span className="tabular-nums">{failedCount}</span>{" "}
              {failedCount === 1 ? "repository" : "repositories"} couldn&rsquo;t
              be read — you can start the rest and fix them later.
            </span>
          ) : null}
        </span>
        <Button variant="outline" onClick={onSkip} disabled={isSubmitting}>
          Skip for now
        </Button>
        <Button
          onClick={() => onSubmit({ lookbackDays, selections })}
          disabled={isSubmitting || selections.length === 0}
        >
          {isSubmitting
            ? "Starting…"
            : `Start analyzing ${selections.length} ${
                selections.length === 1 ? "repository" : "repositories"
              }`}
        </Button>
      </div>
    </Card>
  )
}
