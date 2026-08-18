import type { BriefStatus } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";

const STATUS: Record<BriefStatus, { label: string; color: string; pulse?: boolean }> = {
  pending: { label: "Pending", color: "var(--muted-foreground)" },
  generating: { label: "Generating", color: "var(--gb-status-in-flight)", pulse: true },
  generated: { label: "Generated", color: "var(--gb-status-at-risk)" },
  delivered: { label: "Delivered", color: "var(--gb-status-shipped)" },
  failed: { label: "Failed", color: "var(--destructive)" },
};

export function StatusBadge({ status, className }: { status: BriefStatus; className?: string }) {
  const { label, color, pulse } = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 font-mono text-xs uppercase tracking-[0.05em] text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", pulse && "animate-pulse")}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
