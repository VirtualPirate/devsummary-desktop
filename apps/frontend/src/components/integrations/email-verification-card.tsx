import { CheckCircle2, Mail, RefreshCw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useEmailVerification,
  useRequestEmailVerification,
} from "@/hooks/api/use-local-settings"
import { extractErrorMessage } from "@/lib/extract-error"

/**
 * Optional email verification.
 *
 * No account and no password: an address goes out, the user clicks the link in
 * their mail client, and the app picks the change up on its next poll — usually
 * within four seconds. There is no "I've clicked it" button because there is
 * nothing for one to do, and the verify URL is never shown or opened here.
 *
 * Nothing in the app is gated on the result today, so the copy promises no
 * unlock — claiming one the user then cannot find is worse than saying plainly
 * that it is optional.
 */
export function EmailVerificationCard() {
  const verification = useEmailVerification()
  const request = useRequestEmailVerification()
  const [draft, setDraft] = useState("")
  // Pressing Resend is the same request; showing the form again is purely local
  // — a different address is only sent once the user submits it.
  const [editing, setEditing] = useState(false)

  const state = verification.data?.data

  const send = async (email: string) => {
    try {
      await request.mutateAsync({ email })
      setEditing(false)
      setDraft("")
      toast.success("Check your email")
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  const header = (
    <CardHeader>
      <CardTitle>Email</CardTitle>
      <CardDescription>
        Optional. Confirm an address and we can reach you about this install —
        there is no account, no password, and nothing here is required to use
        DevSummary.
      </CardDescription>
    </CardHeader>
  )

  if (verification.isPending) {
    return (
      <Card>
        {header}
        <CardContent>
          <Skeleton className="h-9 w-full max-w-sm" />
        </CardContent>
      </Card>
    )
  }

  if (state?.status === "verified") {
    return (
      <Card>
        {header}
        <CardContent className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-4 shrink-0 text-gb-status-shipped" />
          <span>
            <span className="font-medium">{state.email}</span> is verified.
          </span>
        </CardContent>
      </Card>
    )
  }

  if (state?.status === "pending" && !editing) {
    return (
      <Card>
        {header}
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              {state.linkExpired ? (
                <>
                  The link sent to{" "}
                  <span className="font-medium">{state.email}</span> has expired.
                  Send a new one.
                </>
              ) : (
                <>
                  Click the link we sent to{" "}
                  <span className="font-medium">{state.email}</span>. This screen
                  updates on its own once you do.
                </>
              )}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={request.isPending || !state.email}
              onClick={() => {
                if (state.email) void send(state.email)
              }}
            >
              <RefreshCw className="size-3.5" />
              {request.isPending ? "Sending…" : "Resend link"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(state.email ?? "")
                setEditing(true)
              }}
            >
              Use a different address
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      {header}
      <CardContent>
        <form
          className="flex w-full max-w-md flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const email = draft.trim()
            if (email) void send(email)
          }}
        >
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor="verification-email">Email address</Label>
            <Input
              id="verification-email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <Button type="submit" disabled={!draft.trim() || request.isPending}>
            <Mail className="size-4" />
            {request.isPending ? "Sending…" : "Send link"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
