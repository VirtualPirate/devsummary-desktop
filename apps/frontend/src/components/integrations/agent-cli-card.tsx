import type { AgentCliStatus } from "@launchstack/api-interfaces";
import { Check, Play, RefreshCw, Terminal, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useRefreshAgentClis,
  useTestAgentCli,
  useUpdateLocalCredentials,
} from "@/hooks/api/use-local-settings";
import { extractErrorMessage } from "@/lib/extract-error";
import { cn } from "@/lib/utils";
import {
  BADGE,
  PROVIDER_CARD,
  PROVIDER_CARD_SELECTED,
  TONE,
} from "./provider-card.styles";

type MarkFn = (props: { className?: string }) => React.ReactNode;

type CardBadge = { tone: string; icon: React.ReactNode; text: string };

/**
 * Forcing a re-detect is the recovery for every failure a CLI card can show, so
 * the button owns the mutation rather than each card: the detect-failed
 * placeholder needs exactly the same control as the working card. Named
 * "Refresh" because that is the word the page's blocked banner sends the user
 * looking for.
 */
function RefreshButton({ displayName }: { displayName: string }) {
  const refresh = useRefreshAgentClis();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="text-muted-foreground"
      aria-label={`Refresh ${displayName} detection`}
      onClick={() =>
        refresh.mutate(undefined, {
          // A silent failure here is the worst case: the body line keeps its
          // stale text and the button just stops spinning.
          onError: (err) => toast.error(extractErrorMessage(err)),
        })
      }
      disabled={refresh.isPending}
    >
      <RefreshCw
        className={cn("size-3.5", refresh.isPending && "animate-spin")}
      />
    </Button>
  );
}

/** The header both CLI cards share: mark, name, host, state badge. */
function CardHead({
  Mark,
  title,
  host,
  badge,
}: {
  Mark: MarkFn;
  title: string;
  host: string;
  badge: CardBadge;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 flex-none items-center justify-center rounded-md border bg-muted">
        <Mark className="size-[1.125rem]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
          {title}
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
  );
}

/**
 * The key-provider card's twin for a CLI: there is no secret to paste, so the
 * body is "can this run here" and the actions are select, prove, re-detect.
 * Generic over the adapter — a second CLI needs a mark and a `PROVIDERS` entry,
 * not another card.
 */
export function AgentCliCard({
  status,
  host,
  Mark,
  active,
  blocked,
}: {
  status: AgentCliStatus;
  host: string;
  Mark: MarkFn;
  active: boolean;
  /** The selected provider cannot run, so this page is in its warning state. */
  blocked: boolean;
}) {
  const update = useUpdateLocalCredentials();
  const test = useTestAgentCli();

  const loggedOut = status.installed && status.authenticated === false;

  const handleUse = async () => {
    try {
      await update.mutateAsync({ llmProvider: status.id });
      toast.success(`Using ${status.displayName}`);
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleTest = () => {
    test.mutate(status.id, {
      onSuccess: (res) => toast.success(res.data.detail),
      onError: (err) => toast.error(extractErrorMessage(err)),
    });
  };

  const badge: CardBadge = !status.installed
    ? { tone: TONE.mute, icon: null, text: "Not installed" }
    : loggedOut
      ? {
          tone: TONE.warn,
          icon: <TriangleAlert className="size-3" />,
          text: "Not logged in",
        }
      : active
        ? {
            tone: TONE.brand,
            icon: <Check className="size-3" />,
            text: "In use",
          }
        : blocked
          ? {
              tone: TONE.ok,
              icon: <Check className="size-3" />,
              text: "Installed",
            }
          : { tone: TONE.mute, icon: null, text: "Installed" };

  return (
    <article className={cn(PROVIDER_CARD, active && PROVIDER_CARD_SELECTED)}>
      <CardHead
        Mark={Mark}
        title={status.displayName}
        host={host}
        badge={badge}
      />

      <div className="flex items-start gap-2 border-t pt-3.5 text-[0.8125rem] leading-[1.45] text-muted-foreground">
        <Terminal className="mt-px size-3.5 flex-none" />
        {status.installed ? (
          <span className="truncate font-mono text-xs">
            {status.version ? `${status.version} · ` : ""}
            {status.path}
          </span>
        ) : (
          <span>{status.installHint}</span>
        )}
      </div>

      <div className="mt-auto flex gap-2">
        {active ? null : (
          <Button
            size="sm"
            onClick={handleUse}
            disabled={!status.installed || update.isPending}
          >
            Use {status.displayName}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleTest}
          disabled={!status.installed || test.isPending}
        >
          <Play className="size-3.5" />
          {test.isPending ? "Testing…" : "Run test"}
        </Button>
        <RefreshButton displayName={status.displayName} />
      </div>
    </article>
  );
}

/**
 * The detect itself failed, so nothing is known about the CLI — not even
 * whether it is installed. The card still has to be on screen: Refresh is the
 * only way back, and the blocked banner tells the user to press it here.
 */
export function AgentCliErrorCard({
  displayName,
  host,
  Mark,
  detail,
}: {
  displayName: string;
  host: string;
  Mark: MarkFn;
  /** Already extracted — the page owns the query, not this card. */
  detail: string;
}) {
  return (
    <article className={PROVIDER_CARD}>
      <CardHead
        Mark={Mark}
        title={displayName}
        host={host}
        badge={{
          tone: TONE.warn,
          icon: <TriangleAlert className="size-3" />,
          text: "Detection failed",
        }}
      />

      <div className="flex items-start gap-2 border-t pt-3.5 text-[0.8125rem] leading-[1.45] text-muted-foreground">
        <Terminal className="mt-px size-3.5 flex-none" />
        <span>{detail}</span>
      </div>

      {/* Disabled rather than hidden: these two are what a CLI card is for, and
          dropping them reads as "this provider has none". Neither can be
          answered while the detect is the thing that failed. */}
      <div className="mt-auto flex gap-2">
        <Button size="sm" disabled>
          Use {displayName}
        </Button>
        <Button size="sm" variant="outline" disabled>
          <Play className="size-3.5" />
          Run test
        </Button>
        <RefreshButton displayName={displayName} />
      </div>
    </article>
  );
}
