import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SidebarItem({
  to,
  icon,
  children,
  count,
  exact,
  indent,
  trailing,
}: {
  to: string;
  icon?: ReactNode;
  children: ReactNode;
  count?: number;
  exact?: boolean;
  indent?: boolean;
  trailing?: ReactNode;
}) {
  const location = useLocation();
  const active = exact
    ? location.pathname === to
    : location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <div
      className={cn(
        "group relative flex items-center gap-1.5 rounded-lg transition-colors",
        active ? "bg-brand/12" : "hover:bg-muted/60",
      )}
    >
      {active ? (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-brand" />
      ) : null}
      <Link
        to={to}
        className={cn(
          "flex flex-1 items-center gap-2.5 px-3 py-1.5 text-sm transition-colors",
          active ? "text-brand" : "text-muted-foreground hover:text-foreground",
          indent && "pl-7 text-[12px]",
        )}
      >
        {icon ? (
          <span
            className={cn(
              "inline-flex size-4 items-center justify-center",
              active ? "text-brand" : "text-muted-foreground",
            )}
          >
            {icon}
          </span>
        ) : null}
        <span className="flex-1 truncate">{children}</span>
        {typeof count === "number" ? (
          <span
            className={cn(
              "rounded-full px-2 text-[10px] tabular-nums",
              active ? "bg-brand/15 text-brand" : "bg-muted text-muted-foreground",
            )}
          >
            {count}
          </span>
        ) : null}
      </Link>
      {trailing ? <div className="pr-1.5">{trailing}</div> : null}
    </div>
  );
}
