import { useSearch } from "@tanstack/react-router"
import { AlertTriangle, Check } from "lucide-react"
import { PageHeader } from "@/components/devsummary/shared/page-header"
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list"
import { IntegrationTabs } from "@/components/integrations/integration-tabs"
import { SlackConnectionCard } from "@/components/integrations/slack-connection-card"
import { SlackMark } from "@/components/integrations/provider-marks"
import { Button } from "@/components/ui/button"
import { useSlackInstallations, useStartSlackConnect } from "@/hooks/api/use-slack"

/**
 * The OAuth callback redirects here with `?error=<AppError code>` (see
 * SlackInstallationsController.callback), so the raw code would otherwise land
 * in front of the user. "Try again" is only right for the transient cases.
 */
const CALLBACK_ERRORS: Record<string, string> = {
  SLACK_ORG_ALREADY_CONNECTED:
    "This organization already has a Slack workspace connected. Disconnect the current one before connecting a different workspace.",
  SLACK_STATE_INVALID:
    "That install link expired. Start the connection again from this page.",
  SLACK_STATE_USER_MISMATCH:
    "That install link belongs to a different user. Start the connection again from this page.",
  SLACK_NOT_CONFIGURED:
    "Slack isn't configured on this server yet. Contact your administrator.",
  SLACK_OAUTH_EXCHANGE_FAILED:
    "Slack rejected the connection before it completed. Start the connection again from this page.",
  access_denied:
    "The Slack authorization was cancelled. Nothing was connected.",
}

const FALLBACK_CALLBACK_ERROR = "We couldn't connect Slack. Try connecting again."

function ConnectButton({ label }: { label: string }) {
  const mutation = useStartSlackConnect()
  return (
    <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      <SlackMark className="size-4" />
      {mutation.isPending ? "Redirecting…" : label}
    </Button>
  )
}

export function IntegrationsSlackPage() {
  const query = useSlackInstallations()
  const search = useSearch({ strict: false }) as {
    error?: string
    connected?: string
  }

  const installations = query.data?.data ?? []
  const installation = installations[0] ?? null

  // Every Slack endpoint is admin-only, so a viewer's list request is a 403 and
  // there is no workspace data to render read-only.
  const status = (query.error as { response?: { status?: number } } | null)
    ?.response?.status
  const forbidden = status === 403

  const banners = (
    <>
      {search.error ? (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {CALLBACK_ERRORS[search.error] ?? FALLBACK_CALLBACK_ERROR}
        </div>
      ) : null}
      {search.connected && installation ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-gb-status-shipped/30 bg-gb-status-shipped/10 px-4 py-3 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-gb-status-shipped" />
          <span>
            <strong className="font-semibold">Slack connected.</strong> Add a
            channel to a schedule to start posting briefs.
          </span>
        </div>
      ) : null}
    </>
  )

  if (forbidden) {
    return (
      <>
        <IntegrationTabs active="slack" />
        <PageHeader title="Slack" description="Brief delivery to a channel." />
        <div className="flex flex-wrap items-start gap-2 rounded-xl border border-gb-status-at-risk/35 bg-gb-status-at-risk/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gb-status-at-risk" />
          <span>
            <strong className="font-semibold">
              Only owners and admins can manage Slack.
            </strong>{" "}
            Ask one of them to connect a workspace — schedules you create can use
            it once it&rsquo;s connected.
          </span>
        </div>
      </>
    )
  }

  if (query.isPending) {
    return (
      <>
        <IntegrationTabs active="slack" />
        <PageHeader title="Slack" description="Brief delivery to a channel." />
        <SkeletonList rows={1} rowHeight={72} />
      </>
    )
  }

  if (!installation) {
    return (
      <>
        <IntegrationTabs active="slack" />
        {banners}
        <div className="flex min-h-[calc(100svh_-_14rem)] flex-col items-center justify-center gap-5 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl border bg-card shadow-e1">
            <SlackMark className="size-8" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">
              Slack isn&rsquo;t connected
            </h1>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Connect a workspace to post briefs into a channel. Email delivery
              keeps working either way — Slack is an addition, not a replacement.
            </p>
          </div>
          <ConnectButton label="Connect Slack" />
          <ol className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {["Authorize", "Pick a channel", "Invite the bot"].map((step, i) => (
              <li
                key={step}
                className="rounded-full border px-3 py-1 font-mono text-xs text-muted-foreground"
              >
                {i + 1} · {step}
              </li>
            ))}
          </ol>
        </div>
      </>
    )
  }

  return (
    <>
      <IntegrationTabs active="slack" />
      <PageHeader
        eyebrow="Integrations"
        title="Slack"
        description={
          <>
            Briefs post as <span className="font-mono">@DevSummary</span> in the
            channel each schedule names.
          </>
        }
      />
      {banners}
      <SlackConnectionCard installation={installation} />
      <p className="mt-6 text-xs text-muted-foreground">
        One workspace per organization. To move to a different workspace,
        disconnect this one first.
      </p>
    </>
  )
}
