import { useState } from "react"
import { Check, Power, Shield, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getConsent } from "@/env/config-env"

/**
 * Bump this whenever the terms text changes. The stored version is compared
 * against it on every launch, so a bump re-gates every existing install — without
 * one, changing the terms leaves everybody consented to text they never saw.
 *
 * `TERMS_CHANGES` describes what changed in *this* version and is shown only on
 * the re-gate screen; it is empty for 1.0 because there is nothing to compare to.
 */
const TERMS_VERSION = "1.0"
const TERMS_CHANGES: string[] = []

// TODO: confirm the final URLs before release. Nothing links out until they resolve.
const TERMS_URL = "https://finlens.app/devsummary/terms"
const PRIVACY_URL = "https://finlens.app/devsummary/privacy"

const SENT = "a random install ID, app version, OS version, launch date"
const NEVER_SENT = [
  "repository names, commit messages or code",
  "your GitHub token, OpenAI key or SMTP password",
  "brief contents, teammate names or email addresses",
]

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      className="text-brand underline underline-offset-2"
      onClick={() => void window.desktop?.openExternal(href)}
    >
      {children}
    </button>
  )
}

function formatAcceptedAt(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

/**
 * Blocks the whole app behind a single non-dismissible dialog until the terms are
 * accepted. Declining quits — the free-standing app has nothing to show a user who
 * has not agreed to use it.
 *
 * The window renders behind the scrim on purpose (the Radix overlay blurs it): the
 * consent state is resolved before the first render, so there is no frame in which
 * the app is interactive ungated, and the user still gets to see what they are
 * agreeing to reach.
 */
export function ConsentGate({ children }: { children: React.ReactNode }) {
  const initial = getConsent()
  const [accepted, setAccepted] = useState(
    initial.acceptedVersion === TERMS_VERSION,
  )
  const [checked, setChecked] = useState(false)
  const [confirmingQuit, setConfirmingQuit] = useState(false)
  const [saving, setSaving] = useState(false)

  const isUpdate = initial.acceptedVersion !== null
  const previouslyAcceptedOn = formatAcceptedAt(initial.acceptedAt)

  const handleAccept = async () => {
    setSaving(true)
    try {
      await window.desktop?.acceptConsent(TERMS_VERSION)
    } catch (err) {
      // A failed write is our bug, not the user's: they consented, so let them in
      // rather than trapping them behind an error they cannot act on. The gate
      // simply reappears next launch.
      console.error("[consent] acceptance not persisted", err)
    }
    setAccepted(true)
  }

  if (accepted) return children

  return (
    <>
      {children}
      <Dialog open>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-md"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="flex-row items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand">
              <Shield className="size-5" />
            </span>
            <div className="flex flex-col gap-2">
              {isUpdate ? (
                <Badge variant="outline" className="w-fit">
                  Terms updated &middot; v{TERMS_VERSION}
                </Badge>
              ) : null}
              <DialogTitle className="text-lg">
                {isUpdate ? "Please review the changes" : "Before you start"}
              </DialogTitle>
              <DialogDescription>
                {isUpdate ? (
                  <>
                    You accepted version {initial.acceptedVersion}
                    {previouslyAcceptedOn ? ` on ${previouslyAcceptedOn}` : ""}.
                    DevSummary needs your agreement again to keep running.
                  </>
                ) : (
                  <>
                    DevSummary counts installs so we know how many people use it.
                    One anonymous record leaves this machine. Accepting is
                    required to run the app.
                  </>
                )}
              </DialogDescription>
            </div>
          </DialogHeader>

          <ul className="flex flex-col gap-1.5">
            {isUpdate && TERMS_CHANGES.length > 0 ? (
              TERMS_CHANGES.map((change) => (
                <li key={change} className="flex gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-gb-status-shipped" />
                  <span>{change}</span>
                </li>
              ))
            ) : (
              <>
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-gb-status-shipped" />
                  <span>
                    <strong className="font-medium">Sent:</strong> {SENT}
                  </span>
                </li>
                {NEVER_SENT.map((item) => (
                  <li key={item} className="flex gap-2">
                    <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    <span>
                      <strong className="font-medium">Never sent:</strong>{" "}
                      {item}
                    </span>
                  </li>
                ))}
              </>
            )}
          </ul>

          <label
            className="flex cursor-pointer gap-2.5 rounded-lg border p-3 has-data-checked:border-brand has-data-checked:bg-brand/6"
            htmlFor="accept-terms"
          >
            <Checkbox
              id="accept-terms"
              className="mt-0.5"
              checked={checked}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            <span>
              I have read and accept the{" "}
              <ExternalLink href={TERMS_URL}>Terms of Use</ExternalLink> and{" "}
              <ExternalLink href={PRIVACY_URL}>Privacy Policy</ExternalLink>,
              including anonymous install telemetry.
            </span>
          </label>

          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => setConfirmingQuit(true)}>
              Quit
            </Button>
            <Button
              disabled={!checked || saving}
              onClick={() => void handleAccept()}
            >
              {isUpdate ? "Accept and continue" : "Agree and continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingQuit}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-sm"
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            setConfirmingQuit(false)
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="flex-row items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/12 text-destructive">
              <Power className="size-5" />
            </span>
            <div className="flex flex-col gap-2">
              <DialogTitle>Quit DevSummary?</DialogTitle>
              <DialogDescription>
                The app cannot run without your agreement.{" "}
                {isUpdate
                  ? "Your existing data stays untouched on this machine."
                  : "Nothing has been written to this machine yet."}{" "}
                Open DevSummary again any time and accept then.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingQuit(false)}>
              Go back
            </Button>
            <Button
              variant="destructive"
              onClick={() => void window.desktop?.quitApp()}
            >
              Quit DevSummary
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { TERMS_VERSION }
