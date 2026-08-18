import { Moon } from "lucide-react";
import { cn } from "@/lib/utils";

export function NoActivityBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 font-mono text-xs uppercase tracking-[0.05em] text-muted-foreground",
        className,
      )}
    >
      <Moon className="size-3" />
      No activity
    </span>
  );
}
