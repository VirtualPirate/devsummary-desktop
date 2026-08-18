import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useDisconnectGithubInstallation } from "@/hooks/api/use-github-integrations"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountLogin: string
}

export function DisconnectInstallationDialog({
  open,
  onOpenChange,
  accountLogin,
}: Props) {
  const mutation = useDisconnectGithubInstallation()

  const handleConfirm = async () => {
    await mutation.mutateAsync()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {accountLogin}?</DialogTitle>
          <DialogDescription>
            DevSummary will stop syncing commits from{" "}
            <strong>{accountLogin}</strong>&rsquo;s repositories. Briefs you
            already generated stay. The stored token is deleted from this
            machine; to make it unusable everywhere, also revoke it on GitHub.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
