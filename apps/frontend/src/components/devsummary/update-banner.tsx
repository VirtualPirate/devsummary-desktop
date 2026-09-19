import { Download, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useJobActivity } from "@/hooks/api/use-jobs";
import { useAppUpdates } from "@/hooks/use-app-updates";

/**
 * Bottom-right, beside the background-jobs toast and in the same idiom.
 *
 * Silent on `idle`, `downloading` and `error`: a background download nobody
 * asked for is not news, and a failed check belongs on the Settings page, not
 * over the user's work.
 */
export function UpdateBanner() {
  const { state, canInstall, install } = useAppUpdates();
  const { data } = useJobActivity();

  // Restarting kills the backend utilityProcess mid-job, and a half-generated
  // brief has no manual re-send. The hook already polls every 3 s while work is
  // in flight, so this costs nothing new.
  const busy = data?.data?.active ?? false;

  const ready = state.status === "ready";
  // macOS: the update exists but cannot be installed in place, so the button
  // hands the user to the Releases page instead.
  const notifyOnly = state.status === "available" && !canInstall;
  if (!ready && !notifyOnly) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex justify-end"
      role="status"
      aria-live="polite"
    >
      <div className="animate-in fade-in slide-in-from-bottom-4 pointer-events-auto flex min-w-[260px] max-w-sm items-center gap-3 rounded-xl border bg-card px-4 py-3 text-card-foreground shadow-lg duration-300">
        <div className="flex min-w-0 flex-col">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.13em] text-muted-foreground">
            Update
          </span>
          <span className="truncate text-sm font-semibold">
            Version {state.version} {ready ? "is ready" : "is available"}
          </span>
          {ready && busy ? (
            <span className="mt-0.5 text-xs text-muted-foreground">
              Finishing background jobs first — restarting now would lose them.
            </span>
          ) : null}
        </div>
        <Button
          size="sm"
          className="shrink-0"
          disabled={ready && busy}
          onClick={() => void install()}
        >
          {ready ? <RefreshCw className="size-3.5" /> : <Download className="size-3.5" />}
          {ready ? "Restart now" : "Download"}
        </Button>
      </div>
    </div>
  );
}
