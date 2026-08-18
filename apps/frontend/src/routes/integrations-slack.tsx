import { PageHeader } from "@/components/devsummary/shared/page-header"
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list"
import { IntegrationTabs } from "@/components/integrations/integration-tabs"
import { SlackConnectionCard } from "@/components/integrations/slack-connection-card"
import { SlackTokenForm } from "@/components/integrations/slack-token-form"
import { SlackMark } from "@/components/integrations/provider-marks"
import { useSlackInstallations } from "@/hooks/api/use-slack"

export function IntegrationsSlackPage() {
  const query = useSlackInstallations()

  const installations = query.data?.data ?? []
  const installation = installations[0] ?? null

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
        <div className="flex min-h-[calc(100svh_-_14rem)] flex-col items-center justify-center gap-5">
          <div className="flex size-16 items-center justify-center rounded-2xl border bg-card shadow-e1">
            <SlackMark className="size-8" />
          </div>
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              Slack isn&rsquo;t connected
            </h1>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Paste a bot token to post briefs into a channel. Email delivery
              keeps working either way — Slack is an addition, not a replacement.
            </p>
          </div>
          <SlackTokenForm />
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
      <SlackConnectionCard installation={installation} />
      <p className="mt-6 text-xs text-muted-foreground">
        One Slack workspace per DevSummary workspace. To move to a different
        one, disconnect this first.
      </p>
    </>
  )
}
