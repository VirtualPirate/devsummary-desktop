import { Pin } from "lucide-react";
import { useSidebarPrefs, type SidebarScope } from "@/stores/sidebar-prefs-store";
import { cn } from "@/lib/utils";

export function PinToggle({
  scope,
  id,
  className,
}: {
  scope: SidebarScope;
  id: string;
  className?: string;
}) {
  const pinned = useSidebarPrefs((s) => s.pinned[scope].includes(id));
  const togglePin = useSidebarPrefs((s) => s.togglePin);

  return (
    <button
      type="button"
      aria-label={pinned ? "Unpin" : "Pin"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePin(scope, id);
      }}
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition",
        "hover:bg-muted hover:text-foreground",
        pinned
          ? "opacity-100 text-foreground"
          : "opacity-0 group-hover:opacity-100",
        className,
      )}
    >
      <Pin className={cn("size-3.5", pinned && "fill-current")} />
    </button>
  );
}
