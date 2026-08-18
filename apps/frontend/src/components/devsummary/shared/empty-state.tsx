import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-14 text-center">
      {icon ? <div className="mb-1 text-muted-foreground">{icon}</div> : null}
      <div className="text-sm font-medium">{title}</div>
      {description ? <p className="max-w-sm text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
