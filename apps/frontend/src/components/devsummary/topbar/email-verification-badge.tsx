import { useState } from "react";

import { EmailVerificationPanel } from "@/components/integrations/email-verification-card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useEmailVerification } from "@/hooks/api/use-local-settings";

/**
 * "Not Verified" tag in the topbar; opens the same flow as Settings → Email.
 *
 * Hidden until the first answer, so a verified install never flashes it on
 * launch. Stays mounted while the dialog is open, so the poll flipping to
 * `verified` shows the confirmation instead of yanking the dialog away.
 */
export function EmailVerificationBadge() {
  const verification = useEmailVerification();
  const [open, setOpen] = useState(false);
  const status = verification.data?.data?.status;

  if (!open && (!status || status === "verified")) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Badge variant="destructive" asChild>
          <button type="button" className="cursor-pointer hover:bg-destructive/20">
            Not Verified
          </button>
        </Badge>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify your email</DialogTitle>
          <DialogDescription>
            Optional. We send a link; click it in your mail client and this
            updates on its own. No account, no password.
          </DialogDescription>
        </DialogHeader>
        <EmailVerificationPanel />
      </DialogContent>
    </Dialog>
  );
}
