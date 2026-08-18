import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthSession } from "@/hooks/api/use-auth";
import { useMyPendingInvites } from "@/hooks/api/use-invites";

export function PendingInvitesBadge() {
  const session = useAuthSession();
  const userId = session.data?.data?.user.id;
  const { data } = useMyPendingInvites(userId);
  const count = data?.data?.length ?? 0;

  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link to="/invites">
        <Bell className="size-4" />
        {count > 0 ? (
          <span
            className="absolute -top-0.5 -right-0.5 rounded-full bg-brand/15 px-1 text-[10px] font-semibold tabular-nums text-brand"
            aria-label={`${count} pending invites`}
          >
            {count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
