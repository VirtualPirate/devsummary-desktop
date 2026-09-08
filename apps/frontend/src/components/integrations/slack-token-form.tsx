import { SLACK_BOT_SCOPES } from "@launchstack/api-interfaces"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useConnectSlackToken } from "@/hooks/api/use-slack"
import { extractErrorMessage } from "@/lib/extract-error"
import { SlackMark } from "./provider-marks"

/**
 * `chat.postMessage` takes the bot token as an argument, so a pasted token is
 * the whole of what OAuth used to deliver — no callback URL, no client secret.
 */
export function SlackTokenForm() {
  const connect = useConnectSlackToken()
  const [token, setToken] = useState("")

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = token.trim()
    if (!value) return
    try {
      await connect.mutateAsync(value)
      setToken("")
      toast.success("Slack connected")
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  return (
    <form className="w-full max-w-md space-y-4 text-left" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="slack-bot-token">Bot user OAuth token</Label>
        <Input
          id="slack-bot-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="xoxb-…"
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          From your Slack app&rsquo;s <em>OAuth &amp; Permissions</em> page.
          Encrypted on this machine by your OS credential store, and never shown
          again.
        </p>
      </div>

      <div className="rounded-xl border bg-muted/40 p-3 text-xs">
        <div className="mb-1.5 font-medium">Required bot token scopes</div>
        <div className="flex flex-wrap gap-1.5">
          {SLACK_BOT_SCOPES.map((scope) => (
            <span
              key={scope}
              className="rounded-md border bg-card px-2 py-0.5 font-mono text-[0.7rem]"
            >
              {scope}
            </span>
          ))}
        </div>
        <p className="mt-2 text-muted-foreground">
          The bot also has to be invited to each channel you post to —{" "}
          <span className="font-mono">/invite @DevSummary</span>.
        </p>
      </div>

      <Button type="submit" disabled={!token.trim() || connect.isPending}>
        <SlackMark className="size-4" />
        {connect.isPending ? "Checking token…" : "Connect Slack"}
      </Button>
    </form>
  )
}
