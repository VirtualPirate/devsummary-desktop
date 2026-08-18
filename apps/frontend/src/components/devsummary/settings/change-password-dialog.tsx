import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useChangePassword } from "@/hooks/api/use-auth";
import { extractErrorMessage } from "@/lib/extract-error";

const MIN_PASSWORD_LENGTH = 8;

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const changePassword = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  // Length is checked here so a too-short password never costs a round trip;
  // a wrong current password can only come back from the server.
  const [lengthError, setLengthError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setLengthError(null);
    setServerError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setLengthError(
        `Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`,
      );
      return;
    }
    setLengthError(null);

    try {
      await changePassword.mutateAsync({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      toast.success("Password updated");
      handleOpenChange(false);
    } catch (err) {
      setServerError(extractErrorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              You&apos;ll stay signed in here, and be signed out on every other
              device.
            </DialogDescription>
          </DialogHeader>

          {serverError ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl bg-destructive/8 px-3.5 py-2.5 text-sm"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{serverError}</span>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <PasswordInput
              id="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              aria-invalid={serverError ? true : undefined}
              disabled={changePassword.isPending}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput
              id="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              autoComplete="new-password"
              aria-invalid={lengthError ? true : undefined}
              disabled={changePassword.isPending}
              required
            />
            {lengthError ? (
              <p className="text-xs text-destructive" role="alert">
                {lengthError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={changePassword.isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={changePassword.isPending}>
              {changePassword.isPending ? "Updating…" : "Update password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
