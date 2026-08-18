import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { OrgSwitcher } from "@/components/organization/org-switcher";
import { PendingInvitesBadge } from "@/components/organization/pending-invites-badge";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import {
  clearSignedOutUserState,
  useAuthSession,
  useSignOut,
} from "@/hooks/api/use-auth";
import { BrandMark } from "../brand-mark";

export function Topbar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessionQuery = useAuthSession();
  const signOutMutation = useSignOut();

  const userInitial = useMemo(() => {
    const name = sessionQuery.data?.data?.user.name;
    return name ? name.charAt(0).toUpperCase() : "U";
  }, [sessionQuery.data?.data?.user.name]);

  const handleSignOut = async () => {
    await signOutMutation.mutateAsync();
    // Leave the protected shell first, then wipe the cache and the persisted
    // active org — otherwise the next user in this tab inherits both.
    await navigate({ to: "/sign-in" });
    clearSignedOutUserState(queryClient);
  };

  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-md backdrop-saturate-150">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <BrandMark className="h-4" />
          <span className="text-sm font-semibold tracking-tight text-foreground">DevSummary</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <OrgSwitcher />
      </div>

      <div className="flex items-center gap-1.5">
        <PendingInvitesBadge />
        <ThemeToggle />
        <Button variant="ghost" size="sm" onClick={handleSignOut} disabled={signOutMutation.isPending}>
          <LogOut className="size-3.5" />
          <span className="text-xs">Sign out</span>
        </Button>
        <Avatar className="size-7">
          <AvatarFallback className="bg-brand/12 text-[11px] font-semibold text-brand">{userInitial}</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
