import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ReloadButton() {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative transition-transform active:scale-90 motion-reduce:transition-none"
      aria-label={busy ? "Reloading" : "Reload"}
      aria-busy={busy || undefined}
      title="Reload"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        window.location.reload();
      }}
    >
      <RefreshCw
        className={cn("size-4", busy && "animate-spin motion-reduce:animate-none")}
      />
    </Button>
  );
}
