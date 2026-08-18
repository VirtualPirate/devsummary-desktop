import type { ReactNode } from "react";

export function SidebarSection({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      {label ? (
        <div className="px-2 pb-1 font-mono text-xs uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </div>
      ) : null}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}
