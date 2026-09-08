import {
  GITHUB_PAT_CREATE_URL,
  GITHUB_PAT_PERMISSIONS,
} from "@launchstack/api-interfaces"
import { useNavigate } from "@tanstack/react-router"
import { ExternalLink } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useConnectGithubToken } from "@/hooks/api/use-github-integrations"
import { extractErrorMessage } from "@/lib/extract-error"
import { GithubMark } from "./provider-marks"

/**
 * The whole GitHub connect flow on a desktop app: there is no public callback
 * URL, so a pasted fine-grained token replaces the App install. The permission
 * list is the package's, verbatim — the settings screen and this page must not
 * drift from what the backend actually validates.
 */
export function GithubPatForm({
  onConnected = "setup",
}: {
  /** Where to go after a successful paste. `stay` is for the settings screen. */
  onConnected?: "setup" | "stay"
}) {
  const navigate = useNavigate()
  const connect = useConnectGithubToken()
  const [token, setToken] = useState("")

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = token.trim()
    if (!value) return
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
      toast.error(extractErrorMessage(err))
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

      <ul className="space-y-1.5 rounded-xl border bg-muted/40 p-3 text-xs">
        {GITHUB_PAT_PERMISSIONS.map((permission) => (
          <li key={permission.permission}>
            <span className="font-medium">{permission.permission}</span>
            {" → "}
            <span className="font-mono">{permission.access}</span>{" "}
            <span className="text-muted-foreground">
              {permission.required ? "(required)" : "(optional)"} —{" "}
              {permission.reason}
            </span>
          </li>
        ))}
      </ul>

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
