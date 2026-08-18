import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Monitor, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/devsummary/shared/page-header";
import { ChangePasswordDialog } from "@/components/devsummary/settings/change-password-dialog";
import { DevicesDialog } from "@/components/devsummary/settings/devices-dialog";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAuthAccounts,
  useAuthSession,
  useAuthSessions,
  useUpdateUser,
} from "@/hooks/api/use-auth";
import { extractErrorMessage } from "@/lib/extract-error";
import { cn } from "@/lib/utils";

const THEMES: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

const PROVIDER_LABELS: Record<string, string> = {
  credential: "email and password",
  google: "Google",
};

function ThemePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="inline-flex gap-1 rounded-full border bg-card p-1 shadow-e1">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
            theme === value
              ? "bg-brand/12 text-brand"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-[19px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const sessionQuery = useAuthSession();
  const accountsQuery = useAuthAccounts();
  const sessionsQuery = useAuthSessions();
  const updateUser = useUpdateUser();
  const { theme } = useTheme();

  const [name, setName] = useState<string | null>(null);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const user = sessionQuery.data?.data?.user;
  const currentToken = sessionQuery.data?.data?.session.token;
  // `null` means untouched — the input mirrors the session until it's edited,
  // so a name saved in another tab still shows up here.
  const nameValue = name ?? user?.name ?? "";
  const isDirty = user ? nameValue.trim() !== user.name : false;
  const isEmpty = nameValue.trim().length === 0;

  const providers = (accountsQuery.data ?? []).map((account) =>
    PROVIDER_LABELS[account.providerId] ?? account.providerId,
  );
  const hasPassword = (accountsQuery.data ?? []).some(
    (account) => account.providerId === "credential",
  );
  const deviceCount = sessionsQuery.data?.length ?? 0;

  const handleSave = async () => {
    if (!isDirty || isEmpty) return;
    try {
      await updateUser.mutateAsync({ name: nameValue.trim() });
      setName(null);
      toast.success("Name updated");
    } catch (err) {
      toast.error(extractErrorMessage(err));
    }
  };

  const header = (
    <PageHeader title="Settings" description="Your account." />
  );

  if (sessionQuery.isLoading || accountsQuery.isLoading) {
    return (
      <>
        {header}
        <SettingsSkeleton />
      </>
    );
  }

  if (!user) {
    return (
      <>
        {header}
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-destructive/45 bg-destructive/6 p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-destructive/12 text-destructive">
            <AlertTriangle className="size-4" />
          </span>
          <div className="flex-1">
            <div className="text-sm font-medium">
              We couldn&apos;t load your account
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {extractErrorMessage(sessionQuery.error)} Nothing was changed.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sessionQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[720px]">
      {header}

      <Card>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-[19px] bg-brand/12 text-xl font-semibold text-brand">
              {user.name?.charAt(0).toUpperCase() || "U"}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="account-name">Name</Label>
              <Input
                id="account-name"
                value={nameValue}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={isEmpty ? true : undefined}
                disabled={updateUser.isPending}
              />
              {isEmpty ? (
                <p className="text-xs text-destructive" role="alert">
                  Name can&apos;t be empty.
                </p>
              ) : (
                // Email is read-only on purpose: `changeEmail` isn't enabled on
                // the backend, and a greyed-out input reads as broken rather
                // than deliberate.
                <p className="text-xs text-muted-foreground">
                  {user.email}
                  {" · "}
                  {user.emailVerified ? (
                    "verified"
                  ) : (
                    <span className="font-semibold text-gb-status-at-risk">
                      unverified
                    </span>
                  )}
                  {providers.length > 0 ? ` · ${providers.join(", ")}` : null}
                </p>
              )}
            </div>
          </div>

          <div className="h-px bg-border" />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Password</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {hasPassword
                    ? "Signs you out of other devices when you change it"
                    : "You sign in with Google, so this account has no password"}
                </div>
              </div>
              {hasPassword ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPasswordOpen(true)}
                >
                  Change
                </Button>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Devices</div>
                <div
                  className={cn(
                    "mt-0.5 text-xs",
                    sessionsQuery.isError
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {sessionsQuery.isError
                    ? "We couldn't load your devices"
                    : sessionsQuery.isLoading
                      ? "Counting your devices…"
                      : deviceCount === 1
                        ? "Signed in on 1 device, this one"
                        : `Signed in on ${deviceCount} devices, including this one`}
                </div>
              </div>
              {sessionsQuery.isError ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void sessionsQuery.refetch()}
                >
                  Retry
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDevicesOpen(true)}
                >
                  View
                </Button>
              )}
            </div>
          </div>

          <div className="h-px bg-border" />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium">Theme</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                This browser only — currently {theme}
              </div>
            </div>
            <ThemePicker />
          </div>
        </CardContent>

        <CardFooter className="flex flex-col-reverse gap-3 border-t bg-muted/50 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            to="/settings/organization"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Organization settings →
          </Link>
          <Button
            disabled={!isDirty || isEmpty || updateUser.isPending}
            onClick={() => void handleSave()}
          >
            {updateUser.isPending ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      </Card>

      <DevicesDialog
        open={devicesOpen}
        onOpenChange={setDevicesOpen}
        currentToken={currentToken}
      />
      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
      />
    </div>
  );
}
