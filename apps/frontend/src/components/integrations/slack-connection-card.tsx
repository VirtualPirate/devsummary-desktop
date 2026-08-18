import type { SlackChannel, SlackInstallation } from "@launchstack/api-interfaces"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, Check, Lock, Send, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useGetBriefSchedules } from "@/hooks/api/use-brief-schedules"
import {
  useDisconnectSlackInstallation,
  useJoinSlackChannel,
  useSlackChannels,
} from "@/hooks/api/use-slack"
import { extractErrorMessage } from "@/lib/extract-error"
import { SlackMark } from "./provider-marks"
import { SlackTestMessageDialog } from "./slack-test-message-dialog"

const SCOPE_LABEL: Record<string, string> = {
  "chat:write": "Post messages",
  "channels:read": "List public channels",
  "groups:read": "List private channels",
  "users:read": "Read workspace members",
  "channels:join": "Join public channels",
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

/**
 * One row per schedule that names a Slack channel. Derived from the schedules
 * the org already loads plus the channel list — there is no endpoint that joins
 * the two, and a group-by on the backend would be a new response field for a
 * list that is capped at BRIEFS_MAX_SCHEDULES_PER_ORG (20) anyway.
 */
function ScheduleChannelRow({
  channelId,
  scheduleNames,
  channel,
  channelsLoaded,
}: {
  channelId: string
  scheduleNames: string[]
  channel: SlackChannel | undefined
  channelsLoaded: boolean
}) {
  const join = useJoinSlackChannel()
  // Unknown while the channel list is still loading, and unknowable if the list
  // came back without this id — a channel the bot cannot see at all. Neither is
  // a warning, so neither shows one.
  const missingFromWorkspace = channelsLoaded && !channel
  const notInChannel = channel ? !channel.isMember : false

  const handleJoin = () => {
    join.mutate(channelId, {
      onSuccess: () => toast.success(`Joined #${channel?.name ?? channelId}`),
      onError: (err) => toast.error(extractErrorMessage(err)),
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 px-3 py-2">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {channel?.isPrivate ? (
          <Lock className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <span className="shrink-0 font-mono text-sm text-muted-foreground">#</span>
        )}
        <span className="truncate text-sm font-medium">
          {channel ? channel.name : channelId}
        </span>
      </span>

      <span className="flex shrink-0 flex-wrap items-center gap-1.5">
        {scheduleNames.map((name) => (
          <span
            key={name}
            className="max-w-56 truncate rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
          >
            {name}
          </span>
        ))}
      </span>

      {missingFromWorkspace ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gb-status-at-risk/15 px-2.5 py-0.5 text-xs font-medium text-gb-status-at-risk">
          <AlertTriangle className="size-3" />
          Not found in workspace
        </span>
      ) : notInChannel ? (
        <>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gb-status-at-risk/15 px-2.5 py-0.5 text-xs font-medium text-gb-status-at-risk">
            <AlertTriangle className="size-3" />
            Bot not in channel
          </span>
          {channel?.isPrivate ? (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              /invite @DevSummary
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={handleJoin}
              disabled={join.isPending}
            >
              {join.isPending ? "Joining…" : "Join channel"}
            </Button>
          )}
        </>
      ) : channel ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gb-status-shipped/15 px-2.5 py-0.5 text-xs font-medium text-gb-status-shipped">
          <Check className="size-3" />
          Bot in channel
        </span>
      ) : null}
    </div>
  )
}

function DisconnectSlackDialog({
  open,
  onOpenChange,
  installationId,
  teamName,
  scheduleCount,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  installationId: string
  teamName: string
  scheduleCount: number
}) {
  const mutation = useDisconnectSlackInstallation()

  const handleConfirm = () => {
    mutation.mutate(installationId, {
      onSuccess: () => {
        toast.success(`Disconnected ${teamName}`)
        onOpenChange(false)
      },
      onError: (err) => toast.error(extractErrorMessage(err)),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {teamName}?</DialogTitle>
          <DialogDescription>
            {scheduleCount > 0 ? (
              <>
                <strong>
                  {scheduleCount} {scheduleCount === 1 ? "schedule posts" : "schedules post"}{" "}
                  to Slack.
                </strong>{" "}
                They keep running and keep emailing, but their Slack delivery
                will fail until a workspace is connected again.{" "}
              </>
            ) : null}
            The bot token is revoked with Slack, so reconnecting means running
            the install flow again.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Disconnecting…" : "Disconnect workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SlackConnectionCard({
  installation,
}: {
  installation: SlackInstallation
}) {
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const channelsQuery = useSlackChannels()
  const schedulesQuery = useGetBriefSchedules()

  const channels = channelsQuery.data?.data ?? []
  const channelsLoaded = channelsQuery.isSuccess
  const schedules = schedulesQuery.data?.data ?? []

  // channelId -> the schedules delivering to it. A channel can carry several.
  const byChannel = new Map<string, string[]>()
  for (const schedule of schedules) {
    const channelId = schedule.delivery.slackChannelId
    if (!channelId) continue
    byChannel.set(channelId, [...(byChannel.get(channelId) ?? []), schedule.name])
  }
  const slackScheduleCount = schedules.filter(
    (schedule) => schedule.delivery.slackChannelId,
  ).length

  const scopes = installation.scope.split(",").filter(Boolean)

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl border bg-card">
          <SlackMark className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{installation.teamName}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gb-status-shipped/15 px-2.5 py-0.5 text-xs font-medium text-gb-status-shipped">
              <span className="size-1.5 rounded-full bg-current" />
              Active
            </span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            Posts as <span className="font-mono">@DevSummary</span> · connected{" "}
            {formatDate(installation.createdAt)}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setTestOpen(true)}>
            <Send className="size-3.5" />
            Send test message
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

      <div className="border-t p-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="min-w-0">
            <dt className="font-mono text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
              Workspace
            </dt>
            <dd className="font-mono text-xs">{installation.teamId}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-mono text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
              Bot user
            </dt>
            <dd className="font-mono text-xs">{installation.botUserId}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-mono text-[0.65rem] uppercase tracking-[0.07em] text-muted-foreground">
              App
            </dt>
            <dd className="font-mono text-xs">{installation.appId}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {scopes.map((scope) => (
            <span
              key={scope}
              title={SCOPE_LABEL[scope] ?? scope}
              className="rounded-md border px-2 py-0.5 font-mono text-[0.7rem] text-muted-foreground"
            >
              {scope}
            </span>
          ))}
        </div>
      </div>

      <div className="border-t p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Schedules posting to Slack</div>
            <div className="text-xs text-muted-foreground">
              The channel is chosen per schedule, not here.
            </div>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/schedules">Manage schedules</Link>
          </Button>
        </div>

        {byChannel.size === 0 ? (
          <p className="text-sm text-muted-foreground">
            No schedule delivers to Slack yet. Add a channel to a schedule and
            briefs will post here.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {[...byChannel.entries()].map(([channelId, scheduleNames]) => (
              <ScheduleChannelRow
                key={channelId}
                channelId={channelId}
                scheduleNames={scheduleNames}
                channel={channels.find((item) => item.id === channelId)}
                channelsLoaded={channelsLoaded}
              />
            ))}
          </div>
        )}

        {channelsQuery.isError ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Couldn&rsquo;t read the channel list from Slack, so channel names and
            bot membership aren&rsquo;t shown. {extractErrorMessage(channelsQuery.error)}
          </p>
        ) : null}
      </div>

      <SlackTestMessageDialog open={testOpen} onOpenChange={setTestOpen} />
      <DisconnectSlackDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        installationId={installation.id}
        teamName={installation.teamName}
        scheduleCount={slackScheduleCount}
      />
    </Card>
  )
}
