import { useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import type { BriefCommitResponse } from "@launchstack/api-interfaces";
import { cn } from "@/lib/utils";
import { CommitTypeChip } from "./commit-type-chip";

// Relative label ("just now", "5m", "3h", "2d") with the full timestamp on hover.
function formatRelative(iso: string | null): { label: string; title: string } {
  if (!iso) return { label: "—", title: "Unknown date" };
  const date = new Date(iso);
  const title = date.toLocaleString();
  const diffMs = Date.now() - date.getTime();
  const min = Math.round(diffMs / 60000);
  const hr = Math.round(diffMs / 3600000);
  const day = Math.round(diffMs / 86400000);
  let label: string;
  if (diffMs < 60000) label = "just now";
  else if (min < 60) label = `${min}m`;
  else if (hr < 24) label = `${hr}h`;
  else if (day < 30) label = `${day}d`;
  else label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { label, title };
}

export function CommitRow({ commit }: { commit: BriefCommitResponse }) {
  const [open, setOpen] = useState(false);
  const time = formatRelative(commit.authoredAt);
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
          <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground md:inline">
            {commit.repositoryFullName}
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {commit.sha.slice(0, 7)}
        </span>
        <span
          className="shrink-0 text-[11px] text-muted-foreground"
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
