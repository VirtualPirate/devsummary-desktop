import { cn } from "@/lib/utils";

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground", className)}>
      {children}
    </div>
  );
}
