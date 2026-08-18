import { AlertTriangle, Check, Lock, Search, Send } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useJoinSlackChannel,
  useSendSlackTestMessage,
  useSlackChannels,
} from "@/hooks/api/use-slack"
import { extractErrorMessage } from "@/lib/extract-error"
import { cn } from "@/lib/utils"

const TEST_TEXT =
  "*Test message from DevSummary*\nIf you can read this, briefs for this workspace will arrive here. This is not a real brief."

/**
 * Proves delivery end to end before a schedule is trusted with it: same token,
 * same `chat.postMessage` path a brief takes, so `not_in_channel` surfaces here
 * instead of hours later on a failed brief.
 */
export function SlackTestMessageDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Only fetch once the dialog is actually opened — the channel list is a paged
  // Slack call, and the page renders fine without it.
  const channelsQuery = useSlackChannels({ enabled: open })
  const send = useSendSlackTestMessage()
  const join = useJoinSlackChannel()

  const channels = channelsQuery.data?.data ?? []
  const term = search.trim().toLowerCase()
  const visible = term
    ? channels.filter((channel) => channel.name.toLowerCase().includes(term))
    : channels
  const selected = channels.find((channel) => channel.id === selectedId) ?? null

  const handleSend = () => {
    if (!selected) return
    send.mutate(
      { channelId: selected.id, text: TEST_TEXT },
      {
        onSuccess: () => {
          toast.success(`Test posted to #${selected.name}`)
          onOpenChange(false)
        },
        onError: (err) => toast.error(extractErrorMessage(err)),
      },
    )
  }

  const handleJoin = () => {
    if (!selected) return
    join.mutate(selected.id, {
      onSuccess: () => toast.success(`Joined #${selected.name}`),
      onError: (err) => toast.error(extractErrorMessage(err)),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a test message</DialogTitle>
          <DialogDescription>
            Posts one message as <span className="font-mono">@DevSummary</span>{" "}
            so you can confirm briefs will land where you expect.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search channels…"
              className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {channelsQuery.isPending ? (
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            ) : channelsQuery.isError ? (
              <p className="p-3 text-sm text-muted-foreground">
                {extractErrorMessage(channelsQuery.error)}
              </p>
            ) : visible.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {channels.length === 0
                  ? "No channels visible to the bot yet."
                  : `No channel matches “${search.trim()}”.`}
              </p>
            ) : (
              visible.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setSelectedId(channel.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-accent",
                    channel.id === selectedId && "bg-accent",
                  )}
                >
                  {channel.isPrivate ? (
                    <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="shrink-0 font-mono text-muted-foreground">#</span>
                  )}
                  <span className="truncate">{channel.name}</span>
                  {channel.id === selectedId ? (
                    <Check className="size-3.5 shrink-0 text-brand" />
                  ) : null}
                  {channel.memberCount !== null ? (
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {channel.memberCount}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>

        {selected && !selected.isMember ? (
          <div className="flex flex-wrap items-start gap-2 rounded-xl border border-gb-status-at-risk/35 bg-gb-status-at-risk/10 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gb-status-at-risk" />
            <span className="min-w-40 flex-1">
              <strong className="font-semibold">
                @DevSummary isn&rsquo;t in #{selected.name}.
              </strong>{" "}
              {selected.isPrivate ? (
                <>
                  Run <span className="font-mono">/invite @DevSummary</span> in
                  Slack — a private channel can&rsquo;t be joined from here.
                </>
              ) : (
                "Posting will fail until it joins."
              )}
            </span>
            {selected.isPrivate ? null : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleJoin}
                disabled={join.isPending}
              >
                {join.isPending ? "Joining…" : "Join channel"}
              </Button>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={send.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!selected || send.isPending}>
            <Send className="size-3.5" />
            {send.isPending ? "Sending…" : "Send test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
