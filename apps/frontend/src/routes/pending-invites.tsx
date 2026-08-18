import { useNavigate } from "@tanstack/react-router";
import { MailPlus } from "lucide-react";
import { EmptyState } from "@/components/devsummary/shared/empty-state";
import { SkeletonList } from "@/components/devsummary/shared/skeleton-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RoleBadge } from "@/components/organization/role-badge";
import { colorFromString } from "@/lib/entity-color";
import { useAuthSession } from "@/hooks/api/use-auth";
import {
  useAcceptInvite,
  useDeclineInvite,
  useMyPendingInvites,
} from "@/hooks/api/use-invites";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

export function PendingInvitesPage() {
  const session = useAuthSession();
  const userId = session.data?.data?.user.id;
  const { data, isLoading } = useMyPendingInvites(userId);
  const accept = useAcceptInvite();
  const decline = useDeclineInvite();
  const navigate = useNavigate();
  const setActive = useActiveOrganizationStore((s) => s.setActiveOrganizationId);

  const invites = data?.data ?? [];

  const handleAccept = async (inviteId: string) => {
    const result = await accept.mutateAsync({ inviteId });
    setActive(result.data.organization.id);
    await navigate({ to: "/" });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/12 text-brand">
          <MailPlus className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Pending invites
          </h1>
          <p className="text-sm text-muted-foreground">
            Organizations that have invited you to join.
          </p>
        </div>
      </div>

      {isLoading ? (
        <SkeletonList rows={2} rowHeight={96} />
      ) : invites.length === 0 ? (
        <EmptyState
          icon={<MailPlus className="size-6" />}
          title="No pending invites"
          description="When a teammate invites you to their organization, it'll show up here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {invites.map((invite) => {
            const inviter = invite.invitedBy?.name ?? "Someone";
            return (
              <Card key={invite.id}>
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <span
                    aria-hidden
                    className="grid size-11 shrink-0 place-items-center rounded-xl text-base font-bold text-white"
                    style={{ background: colorFromString(inviter) }}
                  >
                    {inviter.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">
                        {inviter} invited you
                      </span>
                      <RoleBadge role={invite.role} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Expires{" "}
                      {new Date(invite.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      onClick={() => handleAccept(invite.id)}
                      disabled={accept.isPending}
                    >
                      {accept.isPending ? "Accepting…" : "Accept"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => decline.mutate({ inviteId: invite.id })}
                      disabled={decline.isPending}
                    >
                      Decline
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
