import { useState } from "react";
import { Check, CloudUpload, Key, Sparkles, TriangleAlert } from "lucide-react";
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
  PROVIDER_ACTIONS,
  PROVIDER_CARD,
  PROVIDER_CARD_ROW,
  PROVIDER_CARD_SELECTED,
  TONE,
} from "@/components/integrations/provider-card.styles";
import {
  ClaudeMark,
  CodexMark,
  CursorMark,
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
  useUpdateLocalCredentials,
} from "@/hooks/api/use-local-settings";
import { extractErrorMessage } from "@/lib/extract-error";
import { cn } from "@/lib/utils";

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
  defaultModels: { commitAnalysis: string; brief: string; agent: string };
  Mark: (props: { className?: string }) => React.ReactNode;
} & (
  | { kind: "key"; keyPlaceholder: string }
  // What a model id looks like for *this* CLI. Their formats disagree, so the
  // Models card cannot state one shared rule.
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
    defaultModels: {
      commitAnalysis: "gpt-4o-mini",
      brief: "gpt-4o-mini",
      agent: "gpt-4o",
    },
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
      agent: "gemini-3.6-flash",
    },
    keyPlaceholder: "AIza…",
    Mark: GeminiMark,
  },
  "claude-code": {
    kind: "cli",
    name: "Claude Code",
    label: "Claude Code",
    host: "local CLI · claude",
    defaultModels: { commitAnalysis: "haiku", brief: "sonnet", agent: "sonnet" },
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
    // Not an `opencode/*` id: OpenCode Zen refuses every call that is not the
    // opencode TUI. The provider half has to be one the user connected with
    // `opencode auth login`; see `llm-config.ts`.
    defaultModels: {
      commitAnalysis: "openai/gpt-5.6-luna",
      brief: "openai/gpt-5.6-terra",
      agent: "openai/gpt-5.6-terra",
    },
    modelHint: (
      <>
        <code className="font-mono">provider/model</code> ids as printed by{" "}
        <code className="font-mono">opencode models</code>.
      </>
    ),
    Mark: OpenCodeMark,
  },
  cursor: {
    kind: "cli",
    name: "Cursor",
    label: "Cursor",
    host: "local CLI · agent",
    defaultModels: {
      commitAnalysis: "composer-2.5-fast",
      brief: "composer-2.5",
      agent: "composer-2.5",
    },
    modelHint: (
      <>
        Model ids as printed by{" "}
        <code className="font-mono">agent --list-models</code>;{" "}
        <code className="font-mono">auto</code> is valid.
      </>
    ),
    Mark: CursorMark,
  },
  codex: {
    kind: "cli",
    name: "Codex",
    label: "Codex",
    host: "local CLI · codex",
    defaultModels: {
      commitAnalysis: "gpt-5.6-luna",
      brief: "gpt-5.6-terra",
      agent: "gpt-5.6-terra",
    },
    modelHint: (
      <>
        Model ids accepted by <code className="font-mono">codex exec -m</code> —{" "}
        <code className="font-mono">gpt-5.6-luna</code>,{" "}
        <code className="font-mono">gpt-5.6-terra</code>,{" "}
        <code className="font-mono">gpt-5.6-sol</code>.
      </>
    ),
    Mark: CodexMark,
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

/**
 * Where a commit actually goes, named for the provider that is selected.
 *
 * The consent gate says an AI provider receives commit messages and diffs; it
 * cannot say *which*, because nothing is chosen when it runs. This is the
 * sentence that names one, and it lives here because this is where the choice is
 * made — it re-renders on every switch, so it cannot describe a provider the
 * user has moved off.
 */
function EgressNote({ provider }: { provider: LlmProviderName }) {
  const meta = PROVIDERS[provider];
  return (
    <p className="flex gap-2.5 rounded-md border border-dashed px-3.5 py-3 text-[0.8125rem] leading-[1.45] text-muted-foreground">
      <CloudUpload className="mt-px size-4 flex-none" />
      <span>
        {meta.kind === "key" ? (
          <>
            Commit messages and diffs from your tracked branches are sent to{" "}
            <b className="font-medium text-foreground">{meta.name}</b> at{" "}
            <code className="font-mono">{meta.host}</code>, billed to your own
            key.
          </>
        ) : (
          <>
            Commit messages and diffs are handed to the{" "}
            <b className="font-medium text-foreground">{meta.name}</b> binary on
            this machine, which sends them on to whichever account it is logged
            into.
          </>
        )}{" "}
        Briefs are written from the result the same way. Nothing else about your
        repositories leaves this machine.
      </span>
    </p>
  );
}

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
      <div className={PROVIDER_ACTIONS}>
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
  children,
}: {
  provider: KeyProviderName;
  active: boolean;
  hasKey: boolean;
  /** The selected provider has no key, so this page is in its warning state. */
  blocked: boolean;
  children?: React.ReactNode;
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

  const rowHost =
    hasKey && blocked
      ? "Ready — put it back in use to unblock briefs"
      : host;

  if (!active) {
    return (
      <article className={PROVIDER_CARD_ROW}>
        <ProviderTile provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
            {name}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {rowHost}
          </div>
        </div>
        <Badge className={cn(BADGE, badge.tone)}>
          {badge.icon}
          {badge.text}
        </Badge>
        <div className={PROVIDER_ACTIONS}>
          <Button size="sm" onClick={handleUse} disabled={update.isPending}>
            Use {label}
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article className={cn(PROVIDER_CARD, "gap-3.5", PROVIDER_CARD_SELECTED)}>
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
        <KeyForm
          provider={provider}
          size="sm"
          onSaved={() => setReplacing(false)}
          onCancel={hasKey ? () => setReplacing(false) : undefined}
        />
      ) : (
        <>
          <div className="flex items-start gap-2 text-[0.8125rem] text-muted-foreground">
            <Key className="mt-0.5 size-3.5 flex-none" />
            Key stored, encrypted on this machine
          </div>
          <div className={PROVIDER_ACTIONS}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReplacing(true)}
            >
              Replace key
            </Button>
          </div>
        </>
      )}
      {hasKey ? children : null}
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
  field: "commitAnalysisModel" | "briefModel" | "agentModel";
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
      // Spelled out rather than `{ [field]: next }`: a computed key widens the
      // literal to an index signature, and the request type stops being checked.
      await update.mutateAsync(
        field === "briefModel"
          ? { briefModel: next }
          : field === "agentModel"
            ? { agentModel: next }
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

function ModelsBlock({
  commitAnalysisModel,
  briefModel,
  agentModel,
}: {
  commitAnalysisModel: string;
  briefModel: string;
  agentModel: string;
}) {
  return (
    <div className="border-t pt-1">
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
      <ModelRow
        field="agentModel"
        title="Assistant"
        description="The conversational agent. It picks tools in a loop, so a stronger model is the usual choice."
        value={agentModel}
      />
    </div>
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
        <EgressNote provider={selected} />
        <div className="grid grid-cols-1 gap-4 min-[640px]:grid-cols-2">
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
          // Not `hero`: nothing is in use yet, so `Use <CLI>` stays on
          // screen — disabled until the CLI is installed, which is the one
          // thing that has to change here.
          <AgentCliCard
            status={selectedCli}
            host={PROVIDERS[selected].host}
            Mark={PROVIDERS[selected].Mark}
            variant="card"
            blocked
          />
        ) : (
          <AgentCliErrorCard
            displayName={PROVIDERS[selected].name}
            host={PROVIDERS[selected].host}
            Mark={PROVIDERS[selected].Mark}
            detail={detectError ?? DETECT_UNKNOWN}
            variant="card"
          />
        )}
      </div>
    </div>
  );
}

function ProviderSlot({
  option,
  active,
  stored,
  clis,
  detectError,
  blocked,
  children,
}: {
  option: LlmProviderName;
  active: boolean;
  stored: { openai: boolean; gemini: boolean };
  clis: AgentCliStatus[];
  detectError: string | null;
  blocked: boolean;
  children?: React.ReactNode;
}) {
  if (isKeyProvider(option)) {
    return (
      <ProviderCard
        provider={option}
        active={active}
        hasKey={stored[option]}
        blocked={blocked}
      >
        {children}
      </ProviderCard>
    );
  }
  const cli = clis.find((c) => c.id === option);
  const variant = active ? "hero" : "row";
  return cli ? (
    <AgentCliCard
      status={cli}
      host={PROVIDERS[option].host}
      Mark={PROVIDERS[option].Mark}
      variant={variant}
      blocked={blocked}
    >
      {children}
    </AgentCliCard>
  ) : (
    <AgentCliErrorCard
      displayName={PROVIDERS[option].name}
      host={PROVIDERS[option].host}
      Mark={PROVIDERS[option].Mark}
      detail={detectError ?? DETECT_UNKNOWN}
      variant={variant}
    />
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
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-[4.5rem] w-full" />
          <Skeleton className="h-[4.5rem] w-full" />
          <Skeleton className="h-[4.5rem] w-full" />
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
  const others = ALL_PROVIDERS.filter((p) => p !== provider);
  // Models stay on the hero except: no-key key provider, detect-failed CLI.
  const heroModels =
    (isKeyProvider(provider) ? stored[provider] : Boolean(selectedCli)) ? (
      <ModelsBlock
        commitAnalysisModel={status?.commitAnalysisModel ?? ""}
        briefModel={status?.briefModel ?? ""}
        agentModel={status?.agentModel ?? ""}
      />
    ) : null;

  return (
    <>
      <IntegrationTabs active="ai" />
      <PageHeader
        eyebrow="Integrations"
        title="AI"
        description={PAGE_DESCRIPTION}
      />
      <div className="space-y-6">
        <EgressNote provider={provider} />
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
                  <code className="font-mono">NOT_CONFIGURED</code> until a key
                  for {PROVIDERS[provider].label} is saved, or another provider
                  is put in use.{/* "a {label}" was "a OpenAI" half the time */}
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
            <h2 className={SECTION_TITLE}>In use</h2>
            <p className={cn(SECTION_BODY, "max-w-[70ch]")}>
              A change applies to the next job — no restart. Each provider keeps
              its own model pair.
            </p>
          </div>
          <ProviderSlot
            option={provider}
            active
            stored={stored}
            clis={clis}
            detectError={detectError}
            blocked={blocked}
          >
            {heroModels}
          </ProviderSlot>
        </section>

        <section>
          <div className="mb-3">
            <h2 className={SECTION_TITLE}>Other providers</h2>
            <p className={cn(SECTION_BODY, "max-w-[70ch]")}>
              Every key can be stored and every installed CLI is offered.
              Putting one in use is what switches the jobs.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {others.map((option) => (
              <ProviderSlot
                key={option}
                option={option}
                active={false}
                stored={stored}
                clis={clis}
                detectError={detectError}
                blocked={blocked}
              />
            ))}
          </div>
        </section>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Keys are encrypted on this machine by your OS credential store, and are
        never read back into the app. A CLI provider stores no key at all — it
        uses the login you already have in your terminal.
      </p>
    </>
  );
}
