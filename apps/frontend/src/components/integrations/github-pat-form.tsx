import {
  GITHUB_PAT_CREATE_URL,
  GITHUB_PAT_PERMISSIONS,
} from "@launchstack/api-interfaces"
import { useNavigate } from "@tanstack/react-router"
import { AlertTriangle, ExternalLink } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useConnectGithubToken } from "@/hooks/api/use-github-integrations"
import { extractErrorMessage } from "@/lib/extract-error"
import { cn } from "@/lib/utils"
import { GithubMark } from "./provider-marks"

/**
 * The constant's `permission` is a path ("Repository permissions → Contents")
 * because it has to tell the user where to look on GitHub's token page; a row
 * beside a screenshot of that page only needs the leaf.
 */
function leafName(permission: string) {
  return permission.slice(permission.lastIndexOf("→") + 1).trim()
}

/**
 * The whole GitHub connect flow on a desktop app: there is no public callback
 * URL, so a pasted fine-grained token replaces the App install. The permission
 * list is the package's, verbatim — the settings screen and this page must not
 * drift from what the backend actually validates.
 *
 * Which entries are rows and which are the footnote comes from `required`, not
 * from a list here: the box is the path 99% of users take, and an optional
 * org-only grant reads as a fourth thing to go do if it sits in the fill.
 */
export function GithubPatForm({
  onConnected = "setup",
  dense = false,
}: {
  /** Where to go after a successful paste. `stay` is for the settings screen. */
  onConnected?: "setup" | "stay"
  /** Tighter rows, for the Replace-token Card where the list is a reminder
      rather than the screen's decision. */
  dense?: boolean
}) {
  const navigate = useNavigate()
  const connect = useConnectGithubToken()
  const [token, setToken] = useState("")
  // The permission list below is the diagnosis for a rejected token, so the
  // server's message belongs above it and stays there — a toast is gone before
  // the user has re-read the row it is about.
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = token.trim()
    if (!value) return
    setError(null)
    try {
      await connect.mutateAsync({ token: value })
      setToken("")
      toast.success("GitHub connected")
      if (onConnected === "setup") {
        await navigate({
          to: "/integrations/github/setup",
          search: { connected: "1" },
        })
      }
    } catch (err) {
      setError(extractErrorMessage(err))
    }
  }

  return (
    <form className="w-full max-w-md space-y-4 text-left" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="github-pat">Fine-grained personal access token</Label>
        <Input
          id="github-pat"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="github_pat_…"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Encrypted on this machine by your OS credential store, and never shown
          again.
        </p>
      </div>

      {error ? (
        // Same treatment as the unconfigured-repos banner on the integrations
        // page — both say "this is not reading anything yet".
        <div
          role="alert"
          className="flex gap-2.5 rounded-xl border border-gb-status-at-risk/35 bg-gb-status-at-risk/10 px-3.5 py-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gb-status-at-risk" />
          <span className="min-w-0 flex-1">{error}</span>
        </div>
      ) : null}

      <div className="min-w-0">
        <div className="min-w-0 rounded-xl border bg-muted/40 wrap-break-word">
          {GITHUB_PAT_PERMISSIONS.filter((permission) => permission.required).map(
            (permission) => (
              <div
                key={permission.permission}
                className={cn(
                  "flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t px-3 py-2 first:border-t-0",
                  dense && "px-2.5 py-1.5"
                )}
              >
                <span className="text-[13px] font-medium">
                  {leafName(permission.permission)}
                </span>
                {/* One flex line for chip + badge + reason so the reason is
                    what wraps when the column is narrow, not the access. */}
                <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-x-2 gap-y-1.5">
                  <Badge
                    variant="outline"
                    className="border-border-strong bg-background font-mono text-[11px]"
                  >
                    {permission.access}
                  </Badge>
                  <Badge variant="secondary">required</Badge>
                  <span className="min-w-0 flex-1 basis-28 text-xs text-muted-foreground">
                    {permission.reason}
                  </span>
                </div>
              </div>
            )
          )}
        </div>
        {GITHUB_PAT_PERMISSIONS.filter((permission) => !permission.required).map(
          (permission) => (
            <p
              key={permission.permission}
              className={cn(
                "mt-2 px-0.5 text-xs text-muted-foreground",
                dense && "mt-1.5"
              )}
            >
              {leafName(permission.permission)} (optional) — {permission.reason}
            </p>
          )
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!token.trim() || connect.isPending}>
          <GithubMark className="size-4" />
          {connect.isPending ? "Checking token…" : "Connect GitHub"}
        </Button>
        <Button asChild variant="ghost" size="sm">
          {/* target="_blank" — the Electron main process turns this into
              shell.openExternal, so it lands in the system browser. */}
          <a href={GITHUB_PAT_CREATE_URL} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" />
            Create a token
          </a>
        </Button>
      </div>
    </form>
  )
}
