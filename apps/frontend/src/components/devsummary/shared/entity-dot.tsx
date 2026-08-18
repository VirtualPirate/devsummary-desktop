import { cn } from "@/lib/utils";

export function EntityDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("inline-block size-1.5 rounded-full shrink-0", className)}
      style={{ background: color }}
    />
  );
}
