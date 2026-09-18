import { useState } from "react"
import { Check, CloudUpload, Power, Shield, X } from "lucide-react"

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

import { LegalDialog, type LegalDocId } from "./legal-dialog"

/**
 * Bump this whenever the terms text changes. The stored version is compared
 * against it on every launch, so a bump re-gates every existing install — without
 * one, changing the terms leaves everybody consented to text they never saw.
 *
 * `TERMS_CHANGES` describes what changed in *this* version and is shown only on
 * the re-gate screen; it is empty for 1.0 because there is nothing to compare to.
 */
// Still 1.0 after the wording above changed: nothing has been released, so
// there is no install consented to the earlier text that a bump would re-gate.
// The rule applies from the first shipped build onward — which means the next
// terms change after 0.1.0 ships MUST bump. The update check added on
// 2026-09-18 is named in the dialog below rather than re-gating anyone.
const TERMS_VERSION = "1.0"
const TERMS_CHANGES: string[] = []

const SENT = "a random install ID, app version, OS version, launch date"
const NEVER_SENT = [
  "repository names, commit messages or code",
  "your GitHub token, AI provider key or Slack bot token",
  "brief contents, teammate names or email addresses",
]

/**
 * The list above is about *this* transmission — the install ping — and read on
 * its own it says the app is airtight, which it is not: analysing a commit means
 * sending its message and diff to whichever AI provider the user picks. That
 * destination is theirs to choose and is named on the AI settings page at the
 * moment they choose it, so the honest thing here is to say it exists rather
 * than to name a provider that has not been selected yet.
 */
const AI_EGRESS =
  "Analysing a commit sends its message and diff to the AI provider you choose — an API key you paste, or a coding-agent CLI already on this machine. Nothing is sent until you connect one, and the AI page names where it goes."

/**
 * The second always-on connection, and the only one that exists before the user
 * has connected anything. Named here because the dialog's whole claim is that
 * you are told what leaves the machine.
 */
const UPDATE_EGRESS =
  "DevSummary asks github.com every six hours whether a newer version exists, and downloads it in the background. No account, no install ID — an IP address and a version number. Settings → Updates switches it off."

function DocLink({
  doc,
  onOpen,
  children,
}: {
  doc: LegalDocId
  onOpen: (doc: LegalDocId) => void
  children: string
}) {
  return (
    <button
      type="button"
      className="text-brand underline underline-offset-2"
      // The label wraps this button, so a click would otherwise toggle the
      // checkbox on the way past.
      onClick={(event) => {
        event.preventDefault()
        onOpen(doc)
      }}
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
  const [viewingDoc, setViewingDoc] = useState<LegalDocId | null>(null)
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
                    <strong className="font-medium">Sent to us:</strong>{" "}
                    {SENT}
                  </span>
                </li>
                {NEVER_SENT.map((item) => (
                  <li key={item} className="flex gap-2">
                    <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    <span>
                      <strong className="font-medium">
                        Never sent to us:
                      </strong>{" "}
                      {item}
                    </span>
                  </li>
                ))}
              </>
            )}
          </ul>

          <p className="flex gap-2 rounded-lg border border-dashed p-3 text-muted-foreground">
            <CloudUpload className="mt-0.5 size-3.5 shrink-0" />
            <span>{AI_EGRESS}</span>
          </p>

          <p className="flex gap-2 rounded-lg border border-dashed p-3 text-muted-foreground">
            <CloudUpload className="mt-0.5 size-3.5 shrink-0" />
            <span>{UPDATE_EGRESS}</span>
          </p>

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
              <DocLink doc="terms" onOpen={setViewingDoc}>
                Terms of Use
              </DocLink>{" "}
              and{" "}
              <DocLink doc="privacy" onOpen={setViewingDoc}>
                Privacy Policy
              </DocLink>
              , including anonymous install telemetry.
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

      <LegalDialog doc={viewingDoc} onClose={() => setViewingDoc(null)} />

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
