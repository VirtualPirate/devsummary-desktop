import type { GithubBranch } from "@launchstack/api-interfaces"
import { AlertTriangle, Check, ChevronDown, GitBranch, RefreshCw } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
]

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

/** "updated 2 hours ago" — the only signal that separates a live branch from a
 *  stale one when a repo has 200 of them. */
function relativeTime(iso: string | null): string {
  if (!iso) return "no commits"
  const diff = Date.parse(iso) - Date.now()
  if (Number.isNaN(diff)) return "unknown"
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit)
  }
  return "just now"
}

type Props = {
  /** Ordered newest-committed-first; the default branch carries `isDefault`. */
  branches: GithubBranch[]
  truncated?: boolean
  isLoading?: boolean
  isError?: boolean
  errorMessage?: string
  onRetry?: () => void
  /** The one branch this repository will be read on. */
  value: string | null
  onSelect: (branch: string) => void
  disabled?: boolean
  /** Rendered when nothing is selected yet. */
  placeholder?: string
  className?: string
}

/**
 * Presentational: the caller owns the branch query, because the setup screen
 * needs each row's default branch to prefill before anything is opened.
 */
export function BranchPicker({
  branches,
  truncated,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  value,
  onSelect,
  disabled,
  placeholder = "Choose a branch",
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const label = value ?? placeholder
  // Picking is terminal — one branch per repository, so the popover closes on
  // select rather than staying open for a second choice.
  const select = (branch: string) => {
    onSelect(branch)
    setOpen(false)
  }

  const defaultOption = branches.find((b) => b.isDefault)
  const others = branches.filter((b) => !b.isDefault)
  const noBranches = !isLoading && !isError && branches.length === 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading || noBranches}
          className={cn(
            "h-8 w-full justify-between gap-2 font-mono text-xs sm:w-52",
            !value && "font-sans font-medium text-muted-foreground",
            !value && !noBranches && !isError && "border-brand text-brand",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranch className="size-3.5 shrink-0" />
            <span className="truncate">
              {isLoading
                ? "Loading…"
                : noBranches
                  ? "No branches"
                  : isError
                    ? "Unavailable"
                    : label}
            </span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[--radix-popover-trigger-width] min-w-72 p-0">
        {isError ? (
          <div className="space-y-3 p-4 text-center">
            <AlertTriangle className="mx-auto size-5 text-destructive" />
            <div>
              <p className="text-sm font-semibold">Couldn&rsquo;t load branches</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {errorMessage ??
                  "The installation may have lost access to this repository."}
              </p>
            </div>
            {onRetry ? (
              <Button variant="outline" size="sm" onClick={() => onRetry()}>
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
            ) : null}
          </div>
        ) : isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-20" />
          </div>
        ) : (
          <Command>
            <CommandInput placeholder={`Filter ${branches.length} branches…`} />
            <CommandList>
              <CommandEmpty>No branch matches.</CommandEmpty>
              {defaultOption ? (
                <CommandGroup heading="Default">
                  <BranchOption
                    branch={defaultOption}
                    selected={value === defaultOption.name}
                    onSelect={select}
                  />
                </CommandGroup>
              ) : null}
              {others.length > 0 ? (
                <CommandGroup heading="Active branches">
                  {others.map((branch) => (
                    <BranchOption
                      key={branch.name}
                      branch={branch}
                      selected={value === branch.name}
                      onSelect={select}
                    />
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              {truncated
                ? "Sorted by last commit. Older branches beyond the first 300 aren’t listed."
                : "Sorted by last commit. We read only the branch you pick."}
            </div>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}

function BranchOption({
  branch,
  selected,
  onSelect,
}: {
  branch: GithubBranch
  selected: boolean
  onSelect: (name: string) => void
}) {
  return (
    <CommandItem value={branch.name} onSelect={onSelect} className="gap-2">
      {/* Round, not a checkbox: one branch per repository, so this is a choice
          between options rather than a set of independent toggles. */}
      <span
        aria-hidden
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full border",
          selected
            ? "border-brand bg-brand text-brand-foreground"
            : "border-input",
        )}
      >
        <Check className={cn("size-3", selected ? "opacity-100" : "opacity-0")} />
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{branch.name}</span>
      <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
        {relativeTime(branch.lastCommitAt)}
      </span>
    </CommandItem>
  )
}
