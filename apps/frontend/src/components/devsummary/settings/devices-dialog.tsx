import { AlertTriangle, Laptop, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAuthSessions,
  useRevokeOtherSessions,
  useRevokeSession,
} from "@/hooks/api/use-auth";
import { extractErrorMessage } from "@/lib/extract-error";
import { describeUserAgent, formatLastActive } from "@/lib/session-device";

function DeviceIcon({ label, current }: { label: string; current: boolean }) {
  const Icon = /iOS|Android/.test(label) ? Smartphone : Laptop;
  return (
    <span
      className={
        current
          ? "grid size-9 shrink-0 place-items-center rounded-xl bg-brand/12 text-brand"
          : "grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"
      }
    >
      <Icon className="size-4" />
    </span>
  );
}

export function DevicesDialog({
  open,
  onOpenChange,
  currentToken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentToken: string | undefined;
}) {
  const sessions = useAuthSessions();
  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();

  const rows = sessions.data ?? [];
  const otherCount = rows.filter((s) => s.token !== currentToken).length;

  const handleRevoke = async (token: string) => {
    try {
      await revokeOne.mutateAsync({ token });
      toast.success("Signed out on that device");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const handleRevokeOthers = async () => {
    try {
      await revokeOthers.mutateAsync();
      toast.success("Signed out everywhere else");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Devices</DialogTitle>
          <DialogDescription>
            Sign out anything you don&apos;t recognise.
          </DialogDescription>
        </DialogHeader>

        {sessions.isLoading ? (
          <div className="flex flex-col gap-3 py-2">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : sessions.isError ? (
          <div className="flex items-start gap-3 rounded-2xl border border-dashed border-destructive/45 bg-destructive/6 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-destructive/12 text-destructive">
              <AlertTriangle className="size-4" />
            </span>
            <div className="flex-1">
              <div className="text-sm font-medium">
                We couldn&apos;t load your devices
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {extractErrorMessage(sessions.error)}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sessions.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {rows.map((session) => {
              const label = describeUserAgent(session.userAgent);
              const isCurrent = session.token === currentToken;
              const isPending =
                revokeOne.isPending &&
                revokeOne.variables?.token === session.token;

              return (
                <div
                  key={session.token}
                  className={
                    isPending
                      ? "flex items-center gap-3 border-b py-3 opacity-60 last:border-b-0"
                      : "flex items-center gap-3 border-b py-3 last:border-b-0"
                  }
                >
                  <DeviceIcon label={label} current={isCurrent} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {label}
                      </span>
                      {isCurrent ? (
                        <Badge className="bg-brand/12 text-brand">
                          This device
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {session.ipAddress ? (
                        <span className="font-mono">{session.ipAddress}</span>
                      ) : (
                        <span>Unknown address</span>
                      )}
                      {" · "}
                      {formatLastActive(session.updatedAt)}
                    </div>
                  </div>
                  {isCurrent ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => void handleRevoke(session.token)}
                    >
                      {isPending ? "Signing out…" : "Sign out"}
                    </Button>
                  )}
                </div>
              );
            })}

            {otherCount === 0 ? (
              <div className="mt-3 rounded-xl border border-dashed py-7 text-center">
                <div className="text-sm font-medium">
                  This is your only session
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sign in on a phone or another browser and it&apos;ll show up
                  here.
                </p>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            disabled={otherCount === 0 || revokeOthers.isPending}
            onClick={() => void handleRevokeOthers()}
          >
            {revokeOthers.isPending
              ? "Signing out…"
              : "Sign out everywhere else"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
