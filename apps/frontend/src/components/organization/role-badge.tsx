import type { OrganizationRole } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";

const roleStyles: Record<OrganizationRole, string> = {
  owner: "bg-brand/12 text-brand",
  admin: "bg-muted text-foreground",
  viewer: "bg-muted text-muted-foreground",
};

export function RoleBadge({ role }: { role: OrganizationRole }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
        roleStyles[role],
      )}
    >
      {role}
    </span>
  );
}
