import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { plain } from "./legal-markdown"

// Imported from the repo root at build time, so the text the consent dialog
// shows, the copies the installer drops in Contents/Resources
// (apps/desktop/electron-builder.yml) and the files on GitHub cannot drift
// apart. Five levels up is ugly and deliberate: the alternative is a second
// copy of a legal document, which is the failure mode this avoids.
import licenseText from "../../../../../LICENSE?raw"
import privacyText from "../../../../../PRIVACY.md?raw"

/**
 * The app used to link these out to a marketing domain that did not resolve —
 * the checkbox asked people to accept two documents they could not open. They ship
 * inside the app instead, so there is no website for the terms to depend on.
 *
 * "Terms of Use" is the license itself: MIT grants the right to run, modify and
 * redistribute the app, and carries the warranty and liability disclaimers. A
 * separate terms document would only restate it in worse prose.
 */
export const LEGAL_DOCS = {
  terms: { title: "Terms of Use", text: licenseText },
  privacy: { title: "Privacy Policy", text: privacyText },
} as const

export type LegalDocId = keyof typeof LEGAL_DOCS

/**
 * Enough Markdown for these two documents and no more — headings, bullets, and
 * the inline markers stripped. A renderer dependency for one dialog of static
 * text is not worth carrying; add one if a third document needs tables, or if a
 * cross-reference in the license has to become a real link rather than plain
 * text (the anchors it points at are all on screen already).
 */
function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-3">
      {text.split(/\n{2,}/).map((block, index) => {
        const heading = /^#{1,6}\s+(.*)$/.exec(block)
        if (heading) {
          return (
            <h3 key={index} className="font-medium text-foreground">
              {plain(heading[1] ?? "")}
            </h3>
          )
        }
        if (block.startsWith("- ")) {
          return (
            <ul key={index} className="flex list-disc flex-col gap-1 pl-4">
              {block
                .split(/^- /m)
                .filter(Boolean)
                .map((item, i) => (
                  <li key={i}>{plain(item)}</li>
                ))}
            </ul>
          )
        }
        return <p key={index}>{plain(block)}</p>
      })}
    </div>
  )
}

export function LegalDialog({
  doc,
  onClose,
}: {
  doc: LegalDocId | null
  onClose: () => void
}) {
  // Unmounted rather than kept open={false}: holding a doc id for the exit
  // animation only buys a frame of the wrong title.
  if (doc === null) return null
  const { title, text } = LEGAL_DOCS[doc]

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1 text-muted-foreground">
          <Markdown text={text} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
