import { useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import type { BriefCommitResponse } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";
import { CommitTypeChip } from "./commit-type-chip";

// The exact instant the commit was authored, in the viewer's own zone —
// `authoredAt` is an instant, so no other zone applies. Locale decides the
// field order and 12/24h ("19 Sep 2026, 14:02" vs "Sep 19, 2026, 02:02 PM").
// The title keeps the full string, seconds included.
function formatAuthoredAt(iso: string | null): { label: string; title: string } {
  if (!iso) return { label: "\u2014", title: "Unknown date" };
  const date = new Date(iso);
  return {
    label: date.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    title: date.toLocaleString(),
  };
}

export function CommitRow({ commit }: { commit: BriefCommitResponse }) {
  const [open, setOpen] = useState(false);
  const time = formatAuthoredAt(commit.authoredAt);
  const author = commit.authorLogin ?? commit.authorName ?? "unknown";

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-accent/40"
      >
        <CommitTypeChip type={commit.analysis?.commitType} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {commit.messageFirstLine ?? "(no message)"}
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {author}
        </span>
        {commit.repositoryFullName ? (
          // The timestamp is ~60px wider than the relative label it replaced,
          // so the repository column gives way a breakpoint earlier.
          <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground lg:inline">
            {commit.repositoryFullName}
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {commit.sha.slice(0, 7)}
        </span>
        <span
          className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
          title={time.title}
        >
          {time.label}
        </span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open ? (
        <div className="px-3 pb-3.5 pl-12 text-sm">
          {commit.analysis ? (
            <>
              <p className="leading-relaxed text-foreground/90">
                {commit.analysis.summary}
              </p>
              {commit.analysis.changes.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {commit.analysis.changes.map((change, i) => (
                    <li key={i}>{change}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-xs italic text-muted-foreground">Not analyzed.</p>
          )}
          {commit.githubUrl ? (
            <a
              href={commit.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              View on GitHub <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
