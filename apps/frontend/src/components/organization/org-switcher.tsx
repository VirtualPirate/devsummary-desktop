import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { colorFromString } from "@/lib/entity-color";
import { cn } from "@/lib/utils";
import { useMyOrganizations } from "@/hooks/api/use-organizations";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";
import { RoleBadge } from "./role-badge";

// Search params holding ids of org-owned entities (project/team/collaborator/
// repository). They are meaningless under a different org, so switching clears
// them. Everything else in the URL — scope type, date range, activity range — is
// org-agnostic and survives the switch.
const ORG_SCOPED_SEARCH_KEYS = ["scopeId", "repo", "collaborator"] as const;

function clearOrgScopedSearch(prev: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...prev };
  for (const key of ORG_SCOPED_SEARCH_KEYS) {
    if (typeof next[key] === "string" && next[key] !== "") next[key] = "";
  }
  // `page` indexes into the fetched pages of the *previous* org's cursor query,
  // so it never carries over — reset it whether or not a filter was cleared, or
  // switching from ?page=2 lands on a page the new org's list doesn't have.
  if (typeof next.page === "number") next.page = 0;
  return next;
}

function OrgAvatar({ name, className }: { name: string; className?: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-lg font-bold text-white",
        className,
      )}
      style={{ background: colorFromString(name) }}
    >
      {initial}
    </span>
  );
}

export function OrgSwitcher() {
  const navigate = useNavigate();
  const { data } = useMyOrganizations();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  const setActiveOrgId = useActiveOrganizationStore(
    (s) => s.setActiveOrganizationId,
  );

  const orgs = data?.data ?? [];
  const active = orgs.find((o) => o.organization.id === activeOrgId) ?? null;

  // Both updates land in the same React batch, so no request is ever made
  // pairing the new X-Organization-Id header with the previous org's ids.
  const handleSelect = (orgId: string) => {
    if (orgId === activeOrgId) return;
    setActiveOrgId(orgId);
    navigate({ to: ".", search: clearOrgScopedSearch, replace: true });
  };

  if (orgs.length === 0) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link to="/organizations/new">
          <Plus className="size-4" />
          Create organization
        </Link>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {active ? (
            <OrgAvatar
              name={active.organization.name}
              className="size-5 text-[0.6rem]"
            />
          ) : (
            <Building2 className="size-4" />
          )}
          <span className="max-w-[12ch] truncate">
            {active?.organization.name ?? "Select org"}
          </span>
          {active ? <RoleBadge role={active.role} /> : null}
          <ChevronDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        {orgs.map((entry) => {
          const isActive = entry.organization.id === activeOrgId;
          return (
            <DropdownMenuItem
              key={entry.organization.id}
              onSelect={() => handleSelect(entry.organization.id)}
              className={cn(
                "gap-2.5",
                isActive && "bg-brand/12 text-brand focus:bg-brand/12 focus:text-brand",
              )}
            >
              <OrgAvatar
                name={entry.organization.name}
                className="size-7 text-[0.7rem]"
              />
              <span className="min-w-0 flex-1 truncate">
                {entry.organization.name}
              </span>
              {isActive ? (
                <Check className="size-4 shrink-0 text-brand" />
              ) : (
                <RoleBadge role={entry.role} />
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/organizations/new" })}>
          <Plus className="size-4" />
          Create new organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
