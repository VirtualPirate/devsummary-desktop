import { useState, type FC } from "react";
import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import { GitBranch, PanelLeft, Plus } from "lucide-react";

import { Thread } from "@/components/assistant-ui/thread";
import {
  ThreadListItems,
  ThreadListNew,
  ThreadListRoot,
  ThreadListSearch,
} from "@/components/assistant-ui/thread-list";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SectionLabel } from "@/components/devsummary/shared/section-label";
import { useCurrentOrganization } from "@/hooks/api/use-organizations";
import { useGithubInstallations } from "@/hooks/api/use-github-integrations";
import { ActivityChartToolUI } from "./activity-chart-tool";
import { AgentRuntimeProvider } from "./agent-runtime-provider";

/**
 * The agent workspace: thread rail plus conversation, filling the whole main
 * area of the shell.
 *
 * The route is registered `fullBleed` (see `router.tsx`), so the shell hands us
 * the full height with no padding and no scrollbar of its own. That is the point
 * of the layout: the conversation viewport is the only scroll container, so
 * nothing has to guess the height of the chrome above it.
 */
export function AgentWorkspace() {
  return (
    <AgentRuntimeProvider>
      {/* Registers the chart renderer for `activity_stats`; renders nothing. */}
      <ActivityChartToolUI />
      <div className="flex h-full min-h-0">
        <aside className="bg-sidebar/55 hidden w-64 shrink-0 flex-col border-r md:flex">
          <ThreadRail />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <ConversationHeader />
          <div className="min-h-0 flex-1">
            <Thread
              components={{ Welcome: AgentWelcome, Suggestions: AgentStarters }}
            />
          </div>
        </div>
      </div>
    </AgentRuntimeProvider>
  );
}

const STARTERS = [
  "What shipped last week?",
  "Which repository has gone quiet, and since when?",
  "Summarize this month for an investor update",
  "Who touched billing code recently?",
];

const AgentWelcome: FC = () => {
  const { data } = useCurrentOrganization();
  const org = data?.data?.organization.name;

  return (
    <div className="mb-6 flex flex-col items-center gap-2 px-4 text-center">
      <h2 className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both text-xl font-semibold tracking-tight duration-200 sm:text-2xl">
        Ask about what your team shipped
      </h2>
      <p className="text-muted-foreground max-w-md text-sm">
        The agent reads {org ? `${org}'s` : "your organization's"} commits,
        briefs, projects and collaborators — nothing outside it.
      </p>
    </div>
  );
};

/**
 * Starter questions. Static rather than runtime-provided: there is no suggestion
 * adapter, so `ThreadPrimitive.Suggestions` renders nothing on its own.
 */
const AgentStarters: FC = () => (
  <div className="flex w-full flex-wrap items-center justify-center gap-2 px-4">
    {STARTERS.map((prompt) => (
      <ThreadPrimitive.Suggestion key={prompt} prompt={prompt} send asChild>
        <Button
          variant="ghost"
          className="text-foreground hover:bg-muted border-border/60 h-auto rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap"
        >
          {prompt}
        </Button>
      </ThreadPrimitive.Suggestion>
    ))}
  </div>
);

function ConversationHeader() {
  const [threadsOpen, setThreadsOpen] = useState(false);
  // Read off the selected thread itself, not by matching ids in the list: with a
  // remote thread list the selection is a local id and the list is keyed by the
  // server's, so the lookup misses and the header says "New thread" over a
  // conversation the rail has already named.
  const title = useAuiState((s) => s.threadListItem.title);

  // `pl-14` on mobile clears the shell's floating nav toggle, which is
  // absolutely positioned over the top-left of the main area.
  return (
    <div className="bg-background/85 flex items-center gap-2.5 border-b py-2.5 pr-4 pl-14 md:px-5">
      <Sheet open={threadsOpen} onOpenChange={setThreadsOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <PanelLeft />
            <span className="sr-only">Threads</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="p-3 pb-0">
            <SheetTitle>
              <SectionLabel>Threads</SectionLabel>
            </SheetTitle>
          </SheetHeader>
          {/* Closing on select keeps the drawer from covering the answer it
              just switched to. */}
          <div className="min-h-0 flex-1" onClick={() => setThreadsOpen(false)}>
            <ThreadRail />
          </div>
        </SheetContent>
      </Sheet>

      <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
        {title || <span className="text-muted-foreground">New thread</span>}
      </span>
      <ScopeChip />
    </div>
  );
}

/**
 * What the agent can actually see. Without it a thin answer reads as a bad model
 * rather than as a repository nobody picked a branch for.
 *
 * Reads the same query the page's gate already ran, so it costs no request.
 */
function ScopeChip() {
  const { data } = useGithubInstallations();
  const tracked = (data?.data ?? [])
    .flatMap((installation) => installation.repositories)
    .filter((repository) => repository.branch !== null);

  if (tracked.length === 0) return null;

  const branches = [...new Set(tracked.map((r) => r.branch))];

  return (
    <span
      className="text-muted-foreground hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs sm:inline-flex"
      title={tracked.map((r) => `${r.fullName} · ${r.branch}`).join("\n")}
    >
      <GitBranch className="size-3" />
      {tracked.length} {tracked.length === 1 ? "repo" : "repos"} ·{" "}
      {branches.length === 1 ? branches[0] : `${branches.length} branches`}
    </span>
  );
}

function ThreadRail() {
  const [search, setSearch] = useState("");
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);

  return (
    <ThreadListRoot className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <SectionLabel className="flex-1">Threads</SectionLabel>
        <ThreadListNew
          variant="outline"
          className="h-7 px-2 text-xs"
          labelClassName="text-xs"
        >
          <Plus className="size-3.5" />
          New
        </ThreadListNew>
      </div>
      {hasThreads && (
        <div className="px-2.5 pb-1">
          <ThreadListSearch value={search} onValueChange={setSearch} />
        </div>
      )}
      <ThreadListItems
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        searchQuery={hasThreads ? search : ""}
      />
    </ThreadListRoot>
  );
}
