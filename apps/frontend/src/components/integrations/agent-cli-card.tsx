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
  Mark: (props: { className?: string }) => React.ReactNode;
  active: boolean;
  /** The selected provider cannot run, so this page is in its warning state. */
  blocked: boolean;
}) {
  const update = useUpdateLocalCredentials();
  const refresh = useRefreshAgentClis();
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

  const badge = !status.installed
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
      <div className="flex items-center gap-3">
        <div className="flex size-9 flex-none items-center justify-center rounded-md border bg-muted">
          <Mark className="size-[1.125rem]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
            {status.displayName}
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
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-label={`Re-detect ${status.displayName}`}
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          <RefreshCw
            className={cn("size-3.5", refresh.isPending && "animate-spin")}
          />
        </Button>
      </div>
    </article>
  );
}
