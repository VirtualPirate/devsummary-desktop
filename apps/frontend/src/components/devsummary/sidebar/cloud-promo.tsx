import { useState } from "react";
import { Cloud, ExternalLink, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const CLOUD_URL = "https://devsummary.app/cloud";

/** In-memory only: resets when the renderer process starts, survives remounts. */
let dismissedThisSession = false;

/**
 * Sidebar footer promo for the hosted product — variant C of
 * `design/cloud-promo/v1/index.html`. Dismissible for the current app session;
 * the next launch shows it again. The one brand-filled surface outside a hero
 * CTA is called out in the demo's trade-offs. `target="_blank"` lands in the
 * system browser: the Electron main process turns it into `shell.openExternal`.
 */
export function CloudPromo() {
  const [dismissed, setDismissed] = useState(dismissedThisSession);

  if (dismissed) return null;

  return (
    <div
      className="relative mt-auto rounded-xl border p-3.5 shadow-e1"
      style={{
        borderColor: "color-mix(in srgb, var(--brand) 20%, var(--border))",
        background:
          "radial-gradient(120% 140% at 8% 0%, color-mix(in srgb, var(--brand) 14%, transparent), transparent 60%), var(--card)",
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute top-1.5 right-1.5 text-muted-foreground"
        onClick={() => {
          dismissedThisSession = true;
          setDismissed(true);
        }}
      >
        <XIcon />
        <span className="sr-only">Close</span>
      </Button>
      <div className="mb-2.5 flex size-[30px] items-center justify-center rounded-[9px] bg-brand/15 text-brand">
        <Cloud className="size-4" />
      </div>
      <h2 className="mb-[3px] text-[13.5px] font-semibold tracking-[-0.01em]">
        Take DevSummary to the cloud
      </h2>
      <p className="mb-[11px] text-xs leading-[1.45] text-muted-foreground">
        Team-shared briefs, schedules that run without your machine on, and nothing for
        teammates to install.
      </p>
      <Button
        asChild
        size="sm"
        className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
      >
        <a href={CLOUD_URL} target="_blank" rel="noreferrer">
          Open DevSummary Cloud
          <ExternalLink className="size-3" />
        </a>
      </Button>
    </div>
  );
}
