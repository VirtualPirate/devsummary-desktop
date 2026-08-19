import { Fragment, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { SectionCard } from "@/components/devsummary/shared/section-card";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { IntegrationTabs } from "@/components/integrations/integration-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useLocalSettings,
  useLocalSettingsUsage,
  useUpdateLocalCredentials,
} from "@/hooks/api/use-local-settings";
import { extractErrorMessage } from "@/lib/extract-error";

const tokens = new Intl.NumberFormat();

function TokenTotals() {
  const usage = useLocalSettingsUsage();
  const data = usage.data?.data;
  if (!data) return null;

  const rows = [
    ["Commit analysis", data.analysisPromptTokens, data.analysisCompletionTokens],
    ["Briefs", data.briefPromptTokens, data.briefCompletionTokens],
  ] as const;

  return (
    <div className="mt-6 border-t pt-4">
      <div className="text-sm font-medium">Tokens used</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        Everything this workspace has spent on your key, from the counts stored
        on each commit analysis and brief.
      </div>
      <dl className="mt-3 grid max-w-md grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground" />
        <dd className="text-right text-muted-foreground">Prompt</dd>
        <dd className="text-right text-muted-foreground">Completion</dd>
        {rows.map(([label, prompt, completion]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd className="text-right font-mono">{tokens.format(prompt)}</dd>
            <dd className="text-right font-mono">
              {tokens.format(completion)}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function OpenAiKeyForm() {
  const update = useUpdateLocalCredentials();
  const [key, setKey] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = key.trim();
    if (!value) return;
    try {
      await update.mutateAsync({ openaiApiKey: value });
      setKey("");
      toast.success("OpenAI key saved");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <form className="max-w-md space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="openai-key">API key</Label>
        <Input
          id="openai-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="sk-…"
          className="font-mono"
        />
      </div>
      <Button type="submit" disabled={!key.trim() || update.isPending}>
        {update.isPending ? "Saving…" : "Save key"}
      </Button>
    </form>
  );
}

function ModelsForm({
  commitAnalysisModel,
  briefModel,
}: {
  commitAnalysisModel: string;
  briefModel: string;
}) {
  const update = useUpdateLocalCredentials();
  const [analysisModel, setAnalysisModel] = useState("");
  const [summaryModel, setSummaryModel] = useState("");

  // Blank submits nothing rather than clearing: an empty field here means "not
  // editing", and the two models are saved together so one form does both.
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: { commitAnalysisModel?: string; briefModel?: string } = {};
    if (analysisModel.trim()) payload.commitAnalysisModel = analysisModel.trim();
    if (summaryModel.trim()) payload.briefModel = summaryModel.trim();
    if (Object.keys(payload).length === 0) return;
    try {
      await update.mutateAsync(payload);
      setAnalysisModel("");
      setSummaryModel("");
      toast.success("Models saved");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <form
      className="mt-6 max-w-md space-y-4 border-t pt-4"
      onSubmit={handleSubmit}
    >
      <div className="space-y-1.5">
        <Label htmlFor="openai-analysis-model">Commit analysis model</Label>
        <Input
          id="openai-analysis-model"
          autoComplete="off"
          spellCheck={false}
          value={analysisModel}
          onChange={(event) => setAnalysisModel(event.target.value)}
          placeholder={commitAnalysisModel}
          className="font-mono"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="openai-brief-model">Brief model</Label>
        <Input
          id="openai-brief-model"
          autoComplete="off"
          spellCheck={false}
          value={summaryModel}
          onChange={(event) => setSummaryModel(event.target.value)}
          placeholder={briefModel}
          className="font-mono"
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={
          (!analysisModel.trim() && !summaryModel.trim()) || update.isPending
        }
      >
        {update.isPending ? "Saving…" : "Save models"}
      </Button>
      <p className="text-xs text-muted-foreground">
        In effect now: <span className="font-mono">{commitAnalysisModel}</span>{" "}
        for commits, <span className="font-mono">{briefModel}</span> for briefs.
        A saved model applies to the next job — no restart.
      </p>
    </form>
  );
}

export function IntegrationsAiPage() {
  const settings = useLocalSettings();
  const status = settings.data?.data;
  const configured = status?.openai ?? false;

  if (settings.isPending) {
    return (
      <>
        <IntegrationTabs active="ai" />
        <PageHeader
          title="AI"
          description="Commit analysis and brief writing run on your own OpenAI key."
        />
        <SkeletonList rows={1} rowHeight={240} />
      </>
    );
  }

  // No key yet: the same centred first-run state GitHub and Slack use, so all
  // three tabs read the same before anything is connected.
  if (!configured) {
    return (
      <>
        <IntegrationTabs active="ai" />
        <div className="flex min-h-[calc(100svh_-_14rem)] flex-col items-center justify-center gap-5">
          <div className="flex size-16 items-center justify-center rounded-2xl border bg-card shadow-e1">
            <Sparkles className="size-8 text-brand" />
          </div>
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              Connect OpenAI
            </h1>
            <p className="mx-auto max-w-sm text-sm text-muted-foreground">
              Paste an API key. DevSummary classifies each commit and writes the
              briefs with it — billed to your key, never ours. Nothing is read
              back into the app once stored.
            </p>
          </div>
          <div className="w-full max-w-sm">
            <OpenAiKeyForm />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <IntegrationTabs active="ai" />
      <PageHeader
        eyebrow="Integrations"
        title="AI"
        description="Classifies each commit and writes the briefs. Billed to your own key."
      />
      <SectionCard
        title="OpenAI"
        description="Pasting a new key replaces the stored one."
        configured={configured}
      >
        <OpenAiKeyForm />
        <ModelsForm
          commitAnalysisModel={status?.commitAnalysisModel ?? ""}
          briefModel={status?.briefModel ?? ""}
        />
        <TokenTotals />
      </SectionCard>
      <p className="mt-6 text-xs text-muted-foreground">
        The key lives in this machine&rsquo;s keychain. Nothing is ever read back
        into the app.
      </p>
    </>
  );
}
