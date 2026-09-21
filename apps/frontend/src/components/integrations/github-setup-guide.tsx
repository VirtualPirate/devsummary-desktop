import { useState } from "react"
import guideShot from "@/assets/github-pat-setup.png"
import { cn } from "@/lib/utils"

const GUIDE_URL = "github.com/settings/personal-access-tokens/new"

const GUIDE_ALT =
  "GitHub's new fine-grained token page with three marked settings: no expiration, only select repositories, and Contents read-only."

/**
 * The screenshot is dark-mode GitHub, framed as an embedded browser window so
 * it reads as intentional on the light theme instead of a broken block. The
 * greys below are GitHub's own chrome colours, not project tokens — they must
 * not change with `.dark`, so they are hardcoded here rather than themed.
 */
export function GithubSetupGuide({ className }: { className?: string }) {
  const [imageFailed, setImageFailed] = useState(false)

  if (imageFailed) {
    return (
      <div
        className={cn(
          "grid gap-2 rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground",
          className,
        )}
      >
        <strong className="font-semibold text-foreground">
          What to select on GitHub
        </strong>
        <div>
          1 — Expiration:{" "}
          <strong className="font-semibold text-foreground">
            No expiration
          </strong>
          .
        </div>
        <div>
          2 — Repository access:{" "}
          <strong className="font-semibold text-foreground">
            Only select repositories
          </strong>
          , then pick the repos to summarize.
        </div>
        <div>
          3 — Permissions: add{" "}
          <strong className="font-semibold text-foreground">
            Contents → Read-only
          </strong>
          . Metadata is added by GitHub.
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border-strong bg-[#0d1117]",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-[#262d38] bg-[#161b22] px-3 py-2">
        <span className="flex gap-[5px]" aria-hidden>
          <i className="size-[9px] rounded-full bg-[#39424f]" />
          <i className="size-[9px] rounded-full bg-[#39424f]" />
          <i className="size-[9px] rounded-full bg-[#39424f]" />
        </span>
        <span className="truncate font-mono text-[11px] text-[#8b949e]">
          {GUIDE_URL}
        </span>
      </div>
      <img
        src={guideShot}
        alt={GUIDE_ALT}
        onError={() => setImageFailed(true)}
        className="block w-full"
      />
      <p className="border-t border-[#262d38] bg-[#161b22] px-3 py-2 text-xs text-[#8b949e]">
        <strong className="font-medium text-[#c9d1d9]">1</strong> No
        expiration · <strong className="font-medium text-[#c9d1d9]">2</strong>{" "}
        Only select repositories ·{" "}
        <strong className="font-medium text-[#c9d1d9]">3</strong> Contents:
        Read-only
      </p>
    </div>
  )
}
