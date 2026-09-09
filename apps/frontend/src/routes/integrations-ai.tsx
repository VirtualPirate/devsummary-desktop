import { useState } from "react";
import { Check, Key, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type {
  AgentCliProviderName,
  AgentCliStatus,
  LlmProviderName,
} from "@launchstack/api-interfaces";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import {
  AgentCliCard,
  AgentCliErrorCard,
} from "@/components/integrations/agent-cli-card";
import { IntegrationTabs } from "@/components/integrations/integration-tabs";
import {
  BADGE,
  PROVIDER_CARD,
  PROVIDER_CARD_SELECTED,
  TONE,
} from "@/components/integrations/provider-card.styles";
import {
  ClaudeMark,
  GeminiMark,
  OpenAiMark,
  OpenCodeMark,
} from "@/components/integrations/provider-marks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAgentClis,
  useLocalSettings,
  useLocalSettingsUsage,
  useUpdateLocalCredentials,
} from "@/hooks/api/use-local-settings";
import { useCurrentOrganization } from "@/hooks/api/use-organizations";
import { extractErrorMessage } from "@/lib/extract-error";
import { cn } from "@/lib/utils";

const tokens = new Intl.NumberFormat();

/**
 * Everything that differs between providers on this page. `kind` splits the two
 * card bodies: a key provider has a secret to paste, a CLI provider has an
 * install to detect.
 */
type ProviderMeta = {
  /** Card title. */
  name: string;
  /** Short form — buttons, field labels, toasts. */
  label: string;
  host: string;
  defaultModels: { commitAnalysis: string; brief: string };
  Mark: (props: { className?: string }) => React.ReactNode;
} & (
  | { kind: "key"; keyPlaceholder: string }
  // What a model id looks like for *this* CLI. The two disagree — aliases for
  // one, `provider/model` for the other — so the Models card cannot say it.
  // A node rather than a string: the command in it wants the mono treatment
  // every other command on this page gets.
  | { kind: "cli"; modelHint: React.ReactNode }
);

const PROVIDERS = {
  openai: {
    kind: "key",
    name: "OpenAI",
    label: "OpenAI",
    host: "api.openai.com",
    defaultModels: { commitAnalysis: "gpt-4o-mini", brief: "gpt-4o-mini" },
    keyPlaceholder: "sk-…",
    Mark: OpenAiMark,
  },
  gemini: {
    kind: "key",
    name: "Google Gemini",
    label: "Gemini",
    host: "generativelanguage.googleapis.com",
    defaultModels: {
      commitAnalysis: "gemini-3.1-flash-lite",
      brief: "gemini-3.1-flash-lite",
    },
    keyPlaceholder: "AIza…",
    Mark: GeminiMark,
  },
  "claude-code": {
    kind: "cli",
    name: "Claude Code",
    label: "Claude Code",
    host: "local CLI · claude",
    defaultModels: { commitAnalysis: "haiku", brief: "sonnet" },
    modelHint: (
      <>
        Model aliases or full ids accepted by{" "}
        <code className="font-mono">claude --model</code>.
      </>
    ),
    Mark: ClaudeMark,
  },
  opencode: {
    kind: "cli",
    name: "OpenCode",
    label: "OpenCode",
    host: "local CLI · opencode",
    defaultModels: {
      commitAnalysis: "opencode/big-pickle",
      brief: "opencode/big-pickle",
    },
    modelHint: (
      <>
        <code className="font-mono">provider/model</code> ids as printed by{" "}
        <code className="font-mono">opencode models</code>.
      </>
    ),
    Mark: OpenCodeMark,
  },
} as const satisfies Record<LlmProviderName, ProviderMeta>;

const ALL_PROVIDERS = Object.keys(PROVIDERS) as LlmProviderName[];

/** The providers whose card body is a key field. */
type KeyProviderName = Exclude<LlmProviderName, AgentCliProviderName>;

const isKeyProvider = (p: LlmProviderName): p is KeyProviderName =>
  PROVIDERS[p].kind === "key";

/** A settled detect that listed no CLI at all: not expected, still recoverable. */
const DETECT_UNKNOWN =
  "Detection returned no result for this CLI. Press Refresh to try again.";

const PAGE_DESCRIPTION =
  "DevSummary classifies every commit and writes every brief with the AI provider you choose — your own API key or a coding-agent CLI on this machine, billed to you, never to us.";

const SECTION_TITLE = "text-[0.9375rem] font-semibold tracking-[-0.01em]";
const SECTION_BODY = "mt-0.5 text-[0.8125rem] text-muted-foreground";
/** The demo's `.card-h` / `.card-b`: 1.125rem × 1.25rem, then a 1.25rem body. */
const CARD_HEAD = "border-b px-5 py-[1.125rem]";
const EMPTY_BOX =
  "rounded-md border border-dashed border-border-strong p-6 text-center text-[0.8125rem] text-muted-foreground";

function ProviderTile({ provider }: { provider: LlmProviderName }) {
  const { Mark } = PROVIDERS[provider];
  return (
    <div className="flex size-9 flex-none items-center justify-center rounded-md border bg-muted">
      <Mark className="size-[1.125rem]" />
    </div>
  );
}

/**
 * One key, one save. The failure lands under the field rather than in a toast —
 * the key is not verified on save, so the only errors are transport and
 * validation, and both belong next to the input that produced them.
 */
function KeyForm({
  provider,
  size,
  onCancel,
  onSaved,
}: {
  provider: KeyProviderName;
  size: "default" | "sm";
  onCancel?: () => void;
  onSaved?: () => void;
}) {
  const update = useUpdateLocalCredentials();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { label, keyPlaceholder } = PROVIDERS[provider];
  const fieldId = `${provider}-api-key`;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = value.trim();
    if (!key) return;
    setError(null);
    try {
      // Stored per provider: pasting a Gemini key must never overwrite the
      // OpenAI one, whichever card the form is open on.
      await update.mutateAsync(
        provider === "gemini" ? { geminiApiKey: key } : { openaiApiKey: key },
      );
      setValue("");
      onSaved?.();
      toast.success(`${label} key saved`);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={size === "sm" ? "space-y-3" : "space-y-4"}
    >
      <div>
        <Label htmlFor={fieldId} className="mb-1.5">
          {label} API key
        </Label>
        <Input
          id={fieldId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder={keyPlaceholder}
          aria-invalid={!!error}
          className="font-mono"
        />
        <p
          className={cn(
            "mt-1.5 text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ??
            `Encrypted on this machine by your OS credential store. Never sent anywhere except ${label}.`}
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size={size} disabled={!value.trim() || update.isPending}>
          {update.isPending ? "Saving…" : "Save key"}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            size={size}
            variant="ghost"
            className="text-muted-foreground"
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ProviderCard({
  provider,
  active,
  hasKey,
  blocked,
}: {
  provider: KeyProviderName;
  active: boolean;
  hasKey: boolean;
  /** The selected provider has no key, so this page is in its warning state. */
  blocked: boolean;
}) {
  const update = useUpdateLocalCredentials();
  const [replacing, setReplacing] = useState(false);
  const { name, label, host } = PROVIDERS[provider];

  const handleUse = async () => {
    try {
      await update.mutateAsync({ llmProvider: provider });
      toast.success(`Using ${label}`);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const badge = active
    ? hasKey
      ? { tone: TONE.brand, icon: <Check className="size-3" />, text: "In use" }
      : {
          tone: TONE.warn,
          icon: <TriangleAlert className="size-3" />,
          text: "No key",
        }
    : hasKey
      ? blocked
        ? {
            tone: TONE.ok,
            icon: <Check className="size-3" />,
            text: "Key stored",
          }
        : { tone: TONE.mute, icon: null, text: "Key stored" }
      : // Not drawn: the demo only ever puts an inactive card next to a stored
        // key. Composed from what it does draw — the neutral badge of the
        // inactive card, the "No key" wording of the active one. Nothing is
        // failing here, so nothing goes amber.
        { tone: TONE.mute, icon: null, text: "No key" };

  const keyLine = active
    ? "Key stored, encrypted on this machine"
    : blocked
      ? "Ready — put it back in use to unblock briefs"
      : "Key stored — its models appear once it is in use";

  return (
    <article className={cn(PROVIDER_CARD, active && PROVIDER_CARD_SELECTED)}>
      <div className="flex items-center gap-3">
        <ProviderTile provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
            {name}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {host}
          </div>
        </div>
        <Badge className={cn(BADGE, badge.tone)}>
          {badge.icon}
          {badge.text}
        </Badge>
      </div>

      {!hasKey || replacing ? (
        <div className="border-t pt-3.5">
          <KeyForm
            provider={provider}
            size="sm"
            onSaved={() => setReplacing(false)}
            onCancel={hasKey ? () => setReplacing(false) : undefined}
          />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-t pt-3.5 text-[0.8125rem] text-muted-foreground">
            <Key className="size-3.5 flex-none" />
            {keyLine}
          </div>
          <div className="mt-auto flex gap-2">
            {active ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReplacing(true)}
              >
                Replace key
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={handleUse} disabled={update.isPending}>
                  Use {label}
                </Button>
                {blocked ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => setReplacing(true)}
                  >
                    Replace key
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </article>
  );
}

/**
 * The current model is shown, not implied by a placeholder: a blank field with
 * the live value greyed behind it reads as filled in when it is empty. `Change`
 * swaps the chip for an input prefilled with that value; `Cancel` sends nothing.
 */
function ModelRow({
  field,
  title,
  description,
  value,
}: {
  field: "commitAnalysisModel" | "briefModel";
  title: string;
  description: string;
  value: string;
}) {
  const update = useUpdateLocalCredentials();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const next = (draft ?? "").trim();
    if (!next) return;
    setError(null);
    try {
      await update.mutateAsync(
        field === "briefModel"
          ? { briefModel: next }
          : { commitAnalysisModel: next },
      );
      setDraft(null);
      toast.success("Model saved");
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 border-t py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 max-w-[46ch] text-xs text-muted-foreground">
          {description}
        </div>
      </div>
      {draft === null ? (
        <div className="flex flex-none items-center gap-2.5">
          <span className="max-w-[18rem] truncate rounded-sm border bg-muted px-2 py-[0.1875rem] font-mono text-[0.8125rem]">
            {value}
          </span>
          <Button size="sm" variant="outline" onClick={() => setDraft(value)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="flex flex-none flex-col items-end gap-1.5">
          <div className="flex items-center gap-2.5">
            <Input
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!error}
              aria-label={`${title} model`}
              className="w-[18rem] font-mono"
            />
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!draft.trim() || update.isPending}
            >
              {update.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      )}
    </div>
  );
}

function ModelsCard({
  provider,
  commitAnalysisModel,
  briefModel,
}: {
  provider: LlmProviderName;
  commitAnalysisModel: string;
  briefModel: string;
}) {
  const meta = PROVIDERS[provider];
  return (
    <Card className="gap-0 rounded-lg py-0">
      <div className={cn(CARD_HEAD, "flex items-center justify-between gap-4")}>
        <div className="min-w-0">
          <h3 className="text-[0.9375rem] font-semibold">Models</h3>
          <p className={SECTION_BODY}>
            {meta.kind === "cli" ? meta.modelHint : `Used by ${meta.label}.`}{" "}
            Each provider keeps its own pair — switching provider switches these
            too.
          </p>
        </div>
        <Badge className={cn(BADGE, TONE.mute, "font-mono")}>{provider}</Badge>
      </div>
      <div className="p-5">
        <ModelRow
          field="commitAnalysisModel"
          title="Commit analysis"
          description="Runs once per commit at ingest. High volume — a small model is the usual choice."
          value={commitAnalysisModel}
        />
        <ModelRow
          field="briefModel"
          title="Brief writing"
          description="Runs once per schedule window, over the analysed commits. This is the text people read."
          value={briefModel}
        />
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <dl className="rounded-md border bg-card px-4 py-3.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-[1.375rem] tracking-[-0.02em]">
        {tokens.format(value)}
      </dd>
      <dd className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">
        {sub}
      </dd>
    </dl>
  );
}

function UsageCard() {
  const usage = useLocalSettingsUsage();
  const org = useCurrentOrganization();
  const data = usage.data?.data;
  const workspace = org.data?.data.organization.name ?? "this workspace";

  const analysis =
    (data?.analysisPromptTokens ?? 0) + (data?.analysisCompletionTokens ?? 0);
  const briefs =
    (data?.briefPromptTokens ?? 0) + (data?.briefCompletionTokens ?? 0);

  return (
    <Card className="gap-0 rounded-lg py-0">
      <div className={CARD_HEAD}>
        <h3 className="text-[0.9375rem] font-semibold">Token usage</h3>
        <p className={SECTION_BODY}>
          Everything {workspace} has spent with your AI provider, counted from
          each stored commit analysis and brief.
        </p>
      </div>
      <div className="space-y-4 p-5">
        {usage.isError ? (
          <div className={EMPTY_BOX}>
            Couldn&rsquo;t load usage. {extractErrorMessage(usage.error)}
          </div>
        ) : usage.isPending || !data ? (
          // A pending query is not "nothing spent" — never flash four zeros.
          <Skeleton className="h-[5.5rem] w-full" />
        ) : analysis + briefs === 0 ? (
          <div className={EMPTY_BOX}>
            Nothing spent yet. Counts appear after the first repository sync
            analyses a commit, or after the first brief runs.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-3">
              <Stat
                label="Commit analysis"
                value={analysis}
                sub={`${tokens.format(data.analysisPromptTokens)} in · ${tokens.format(data.analysisCompletionTokens)} out`}
              />
              <Stat
                label="Briefs"
                value={briefs}
                sub={`${tokens.format(data.briefPromptTokens)} in · ${tokens.format(data.briefCompletionTokens)} out`}
              />
              <Stat
                label="Total"
                value={analysis + briefs}
                sub="since first ingest"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Tokens only. DevSummary does not estimate cost — pricing depends
              on the exact model and your account, and a wrong number here is
              worse than none.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

/**
 * Only while nothing can answer at all: no stored key and no installed CLI.
 * One key or one working CLI and the page is real.
 */
function FirstRun({
  provider,
  clis,
  detectError,
}: {
  provider: LlmProviderName;
  /** Every detected CLI, in server order. */
  clis: AgentCliStatus[];
  /** The detect failed, so "not installed" is not a thing we know. */
  detectError: string | null;
}) {
  const update = useUpdateLocalCredentials();
  /**
   * Picking the CLI here is local only: a first run is by definition the state
   * where it is not installed, and that is exactly what the credentials
   * endpoint rejects with 400. So the tile changes what this screen shows, and
   * the card's own `Use <CLI>` is what saves it once a detect says it can run.
   * `null` means "whatever the server has", which is what a key pick writes
   * through to.
   */
  const [pickedCli, setPickedCli] = useState<AgentCliProviderName | null>(
    isKeyProvider(provider) ? null : provider,
  );
  const selected: LlmProviderName = pickedCli ?? provider;
  const selectedCli = clis.find((cli) => cli.id === selected) ?? null;

  const handleSelect = async (next: LlmProviderName) => {
    if (next === selected) return;
    if (!isKeyProvider(next)) {
      setPickedCli(next);
      return;
    }
    setPickedCli(null);
    try {
      await update.mutateAsync({ llmProvider: next });
      toast.success(`Using ${PROVIDERS[next].label}`);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <div className="flex flex-col items-center justify-center gap-5 pt-14 pb-16">
      <div className="flex size-16 flex-none items-center justify-center rounded-2xl border bg-card shadow-e1">
        <Sparkles className="size-7 text-brand" />
      </div>
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">
          Connect an AI provider
        </h1>
        <p className="mx-auto mt-2 max-w-[26rem] text-sm text-muted-foreground">
          DevSummary classifies each commit and writes the briefs with it. Paste
          a provider&rsquo;s API key, or point it at a coding-agent CLI already
          installed on this machine.
        </p>
      </div>
      <div className="w-full max-w-[46rem] space-y-4">
        <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-3">
          {ALL_PROVIDERS.map((option) => {
            const meta = PROVIDERS[option];
            // Deduped: a provider whose two defaults are the same model would
            // otherwise print it twice on a line that already truncates.
            const models = [
              ...new Set([
                meta.defaultModels.commitAnalysis,
                meta.defaultModels.brief,
              ]),
            ].join(" · ");
            const sub =
              meta.kind === "cli"
                ? detectError
                  ? "detection failed"
                  : clis.find((cli) => cli.id === option)?.installed
                    ? `installed · ${models}`
                    : "not installed"
                : `${meta.defaultModels.commitAnalysis} by default`;
            return (
              <button
                key={option}
                type="button"
                onClick={() => handleSelect(option)}
                disabled={update.isPending}
                className={cn(
                  PROVIDER_CARD,
                  "text-left",
                  option === selected && PROVIDER_CARD_SELECTED,
                )}
              >
                <div className="flex items-center gap-3">
                  <ProviderTile provider={option} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                      {meta.name}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {sub}
                    </div>
                  </div>
                  {option === selected ? (
                    <Badge className={cn(BADGE, TONE.brand)}>
                      <Check className="size-3" />
                      Selected
                    </Badge>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
        {isKeyProvider(selected) ? (
          <Card className="gap-4 rounded-lg p-5">
            {/* Keyed on the provider: a key typed for one must not be submitted
                against the other after the picker changes. */}
            <KeyForm key={selected} provider={selected} size="default" />
          </Card>
        ) : selectedCli ? (
          // Not `active`: nothing is in use yet, so `Use <CLI>` stays on
          // screen — disabled until the CLI is installed, which is the one
          // thing that has to change here.
          <AgentCliCard
            status={selectedCli}
            host={PROVIDERS[selected].host}
            Mark={PROVIDERS[selected].Mark}
            active={false}
            blocked
          />
        ) : (
          <AgentCliErrorCard
            displayName={PROVIDERS[selected].name}
            host={PROVIDERS[selected].host}
            Mark={PROVIDERS[selected].Mark}
            detail={detectError ?? DETECT_UNKNOWN}
          />
        )}
      </div>
    </div>
  );
}

export function IntegrationsAiPage() {
  const settings = useLocalSettings();
  const agents = useAgentClis();
  const status = settings.data?.data;

  // A pending agents query is not "no CLI installed" — resolving it before the
  // first render is what keeps the first-run takeover from flashing.
  if (settings.isPending || agents.isPending) {
    return (
      <>
        <IntegrationTabs active="ai" />
        <PageHeader
          eyebrow="Integrations"
          title="AI"
          description={PAGE_DESCRIPTION}
        />
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-3">
            {ALL_PROVIDERS.map((option) => (
              <Skeleton key={option} className="h-[9.5rem]" />
            ))}
          </div>
          <Skeleton className="h-[11rem]" />
          <Skeleton className="h-[9rem]" />
        </div>
      </>
    );
  }

  const provider = status?.llmProvider ?? "openai";
  // Every CLI the server detected, in its order. A page that derives one of
  // them cannot show a second.
  const clis = agents.data?.data ?? [];
  const selectedCli = clis.find((cli) => cli.id === provider) ?? null;
  // A failed detect is not "not installed": nothing is known either way, and
  // the only way back is the card's own Refresh, so the message has to reach a
  // card rather than die in the query.
  const detectError = agents.isError ? extractErrorMessage(agents.error) : null;
  const stored = {
    openai: status?.openai ?? false,
    gemini: status?.gemini ?? false,
  };

  // A stored key or *any* installed CLI makes this page real.
  if (!stored.openai && !stored.gemini && !clis.some((cli) => cli.installed)) {
    return (
      <>
        <IntegrationTabs active="ai" />
        <FirstRun provider={provider} clis={clis} detectError={detectError} />
      </>
    );
  }

  // Selecting a provider that cannot answer no longer collapses the page — the
  // other providers have to stay on screen, because switching back is the fix.
  // The *selected* CLI's state, not the first one's: another CLI being
  // uninstalled is not this page's warning state.
  const blocked = isKeyProvider(provider)
    ? !stored[provider]
    : !selectedCli?.installed || selectedCli.authenticated === false;
  // Active first, then the rest: the card that decides every job leads.
  const order: LlmProviderName[] = [
    provider,
    ...ALL_PROVIDERS.filter((p) => p !== provider),
  ];

  return (
    <>
      <IntegrationTabs active="ai" />
      <PageHeader
        eyebrow="Integrations"
        title="AI"
        description={PAGE_DESCRIPTION}
      />
      <div className="space-y-6">
        {blocked ? (
          <div className="flex gap-2.5 rounded-md border border-gb-status-at-risk/45 bg-gb-status-at-risk/10 px-3.5 py-3 text-[0.8125rem] leading-[1.45] text-gb-status-at-risk">
            <TriangleAlert className="mt-px size-4 flex-none" />
            {isKeyProvider(provider) ? (
              <div>
                <b className="block font-semibold">
                  {PROVIDERS[provider].label} is selected but has no key.
                </b>
                <p className="[color:color-mix(in_oklab,currentColor_80%,var(--foreground))]">
                  Commit analysis and every scheduled brief will fail with{" "}
                  <code className="font-mono">NOT_CONFIGURED</code> until a{" "}
                  {PROVIDERS[provider].label} key is saved, or another provider
                  is put in use.
                </p>
              </div>
            ) : detectError ? (
              // Third state, and not the same as "not installed": the detect
              // itself failed, so what is wrong is unknown until it is re-run.
              <div>
                <b className="block font-semibold">
                  {PROVIDERS[provider].label} is selected but could not be
                  detected.
                </b>
                <p className="[color:color-mix(in_oklab,currentColor_80%,var(--foreground))]">
                  Commit analysis and every scheduled brief will fail until it
                  answers. {detectError} Press Refresh on its card to try
                  again.
                </p>
              </div>
            ) : selectedCli?.installed ? (
              <div>
                <b className="block font-semibold">
                  {PROVIDERS[provider].label} is selected but not logged in.
                </b>
                <p className="[color:color-mix(in_oklab,currentColor_80%,var(--foreground))]">
                  Commit analysis and every scheduled brief will fail with{" "}
                  <code className="font-mono">API_FAILED</code> until you log
                  in to {PROVIDERS[provider].label} in a terminal. Then press
                  Refresh on its card.
                </p>
              </div>
            ) : (
              <div>
                <b className="block font-semibold">
                  {PROVIDERS[provider].label} is selected but not installed.
                </b>
                <p className="[color:color-mix(in_oklab,currentColor_80%,var(--foreground))]">
                  Commit analysis and every scheduled brief will fail with{" "}
                  <code className="font-mono">NOT_CONFIGURED</code>.{" "}
                  {selectedCli?.installHint ??
                    "Install the CLI, then press Refresh on its card."}
                </p>
              </div>
            )}
          </div>
        ) : null}

        <section>
          <div className="mb-3">
            <h2 className={SECTION_TITLE}>Provider</h2>
            <p className={cn(SECTION_BODY, "max-w-[70ch]")}>
              Every key can be stored and every installed CLI is offered; only
              the selected provider is used. A change applies to the next job —
              no restart.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-3">
            {order.map((option) => {
              if (isKeyProvider(option)) {
                return (
                  <ProviderCard
                    key={option}
                    provider={option}
                    active={option === provider}
                    hasKey={stored[option]}
                    blocked={blocked}
                  />
                );
              }
              const cli = clis.find((c) => c.id === option);
              return cli ? (
                <AgentCliCard
                  key={option}
                  status={cli}
                  host={PROVIDERS[option].host}
                  Mark={PROVIDERS[option].Mark}
                  active={option === provider}
                  blocked={blocked}
                />
              ) : (
                <AgentCliErrorCard
                  key={option}
                  displayName={PROVIDERS[option].name}
                  host={PROVIDERS[option].host}
                  Mark={PROVIDERS[option].Mark}
                  detail={detectError ?? DETECT_UNKNOWN}
                />
              );
            })}
          </div>
        </section>

        <ModelsCard
          provider={provider}
          commitAnalysisModel={status?.commitAnalysisModel ?? ""}
          briefModel={status?.briefModel ?? ""}
        />
        <UsageCard />
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Keys are encrypted on this machine by your OS credential store, and are
        never read back into the app. A CLI provider stores no key at all — it
        uses the login you already have in your terminal.
      </p>
    </>
  );
}
