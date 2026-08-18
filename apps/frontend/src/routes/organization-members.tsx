import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { OrganizationRole } from "@launchstack/api-interfaces";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InviteMemberForm } from "@/components/organization/invite-member-form";
import { RoleBadge } from "@/components/organization/role-badge";
import { colorFromString } from "@/lib/entity-color";
import { extractErrorMessage } from "@/lib/extract-error";
import { cn } from "@/lib/utils";
import { useAuthSession } from "@/hooks/api/use-auth";
import {
  useCurrentOrganization,
  useMyOrganizations,
} from "@/hooks/api/use-organizations";
import {
  useCurrentOrganizationMembers,
  useLeaveOrganization,
  useRemoveMember,
  useUpdateMemberRole,
} from "@/hooks/api/use-members";
import {
  useCurrentOrganizationInvites,
  useResendInvite,
  useRevokeInvite,
} from "@/hooks/api/use-invites";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

function IdentityAvatar({
  seed,
  label,
  className,
}: {
  seed: string;
  label?: string;
  className?: string;
}) {
  const initial = (label ?? seed).trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-xl font-bold text-white",
        className,
      )}
      style={{ background: colorFromString(seed) }}
    >
      {initial}
    </span>
  );
}

export function OrganizationMembersPage() {
  const navigate = useNavigate();
  const session = useAuthSession();
  const current = useCurrentOrganization();
  const myOrgs = useMyOrganizations();
  const membersQuery = useCurrentOrganizationMembers();
  const invitesQuery = useCurrentOrganizationInvites("pending");
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const leave = useLeaveOrganization();
  const resend = useResendInvite();
  const revoke = useRevokeInvite();
  const activeOrgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  const clearActive = useActiveOrganizationStore((s) => s.clear);
  const setActive = useActiveOrganizationStore(
    (s) => s.setActiveOrganizationId,
  );

  const callerRole = current.data?.data.role;
  const callerUserId = session.data?.data?.user.id;
  const members = membersQuery.data?.data ?? [];
  const invites = invitesQuery.data?.data ?? [];
  // Gate on a role we have actually loaded — `callerRole !== "viewer"` is also
  // true while useCurrentOrganization refetches after an org switch, which
  // flashes management controls at viewers.
  const canManageMembers = callerRole === "owner" || callerRole === "admin";
  // Same freshness test as useBootstrapActiveOrganization: React Query serves
  // the cached org list first and keeps it while refetching, so a list we
  // haven't fetched during this mount cannot tell "you have no other
  // organization" from "not loaded yet".
  const listIsFresh = myOrgs.isFetchedAfterMount && !myOrgs.isFetching;

  const handleRoleChange = (memberId: string, role: OrganizationRole) => {
    if (role === "owner") return;
    updateRole.mutate({
      memberId,
      payload: { role: role as "admin" | "viewer" },
    });
  };

  const handleLeave = async () => {
    const orgName = current.data?.data.organization.name;
    // Same as delete-org: choose the next org explicitly, otherwise the
    // bootstrap hook drops us on orgs[0] while this page keeps rendering
    // the roster of the org we just left. Await an untrustworthy list instead of
    // reading "no other org" out of it, or we strand the user on
    // /organizations/new while the bootstrap re-installs orgs[0] behind them.
    const list = listIsFresh ? myOrgs : await myOrgs.refetch();
    if (!list.isSuccess) {
      toast.error("Couldn't load your organizations. Try again.");
      return;
    }
    const nextOrgId =
      list.data.data.find((entry) => entry.organization.id !== activeOrgId)
        ?.organization.id ?? null;
    try {
      await leave.mutateAsync();
      toast.success(
        orgName ? `You left ${orgName}` : "You left the organization",
      );
      if (nextOrgId) {
        setActive(nextOrgId);
        await navigate({ to: "/" });
      } else {
        clearActive();
        await navigate({ to: "/organizations/new" });
      }
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Members"
        description="Invite teammates, set their roles, and manage who has access."
      />
      <div className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
            <CardDescription>
              <span className="tabular-nums">{members.length}</span>{" "}
              {members.length === 1 ? "person" : "people"} in this organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {members.map((m) => {
                const isSelf = m.userId === callerUserId;
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 rounded-xl border px-4 py-3"
                  >
                    <IdentityAvatar
                      seed={m.user.email || m.user.name}
                      label={m.user.name || m.user.email}
                      className="size-9 text-sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          {m.user.name}
                        </span>
                        {isSelf ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">
                            You
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {m.user.email}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {callerRole === "owner" && m.role !== "owner" ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) =>
                            handleRoleChange(m.id, v as OrganizationRole)
                          }
                        >
                          <SelectTrigger className="w-28" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </div>
                    <div className="flex shrink-0 justify-end">
                      {isSelf && m.role !== "owner" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleLeave}
                          disabled={leave.isPending}
                        >
                          Leave
                        </Button>
                      ) : canManageMembers && m.role !== "owner" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeMember.mutate(m.id)}
                          disabled={removeMember.isPending}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {canManageMembers ? (
          <Card>
            <CardHeader>
              <CardTitle>Invite a teammate</CardTitle>
              <CardDescription>
                They&apos;ll get a magic link by email. Invites expire after 7
                days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <InviteMemberForm />
              {invites.length === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  No pending invites — invite someone above to get started.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {invites.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex items-center gap-3 rounded-xl border px-4 py-3"
                    >
                      <IdentityAvatar
                        seed={invite.email}
                        className="size-9 text-sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {invite.email}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          <span className="capitalize">{invite.role}</span> ·
                          expires{" "}
                          {new Date(invite.expiresAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => resend.mutate(invite.id)}
                          disabled={resend.isPending}
                        >
                          Resend
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => revoke.mutate(invite.id)}
                          disabled={revoke.isPending}
                        >
                          Revoke
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
