import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  type AssistantRuntime,
} from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";

import { AgentsAPI } from "@/api/agents.api";
import { streamAgentRun } from "./agent-stream";
import { agentThreadListAdapter } from "./thread-list-adapter";

/**
 * Wires the workspace to the backend's agent.
 *
 * The thread lifecycle is the adapter's, not ours: `initialize()` creates the
 * row on the first message of a new thread and returns the existing id on every
 * message after it, so there is nothing to pre-create and no state where the
 * composer is disabled waiting for one.
 *
 * The one thing we do decide is which thread a fresh page load lands on: the most
 * recent one, so a reload continues the conversation instead of dropping the
 * reader into a blank thread with their answer one click away in the rail.
 * `threadId` is the runtime's controlled input for that, and `onThreadIdChange`
 * its output — pressing New reports `undefined` back and the rail takes over.
 */
export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  // Written after the runtime is built, read only from callbacks that run later.
  const runtimeRef = useRef<AssistantRuntime | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Newest first (the list is ordered by `updatedAt`), and only ever applied
    // once: re-resuming on every list change would yank the reader out of the
    // thread they just switched to.
    void AgentsAPI.listThreads()
      .then((threads) => {
        if (!cancelled && threads[0]) setThreadId(threads[0].id);
      })
      .catch(() => {
        // A failed list is the rail's problem to report, not a reason to block
        // the composer: a new thread still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runtime = useLangGraphRuntime({
    threadId,
    onThreadIdChange: setThreadId,
    unstable_threadListAdapter: agentThreadListAdapter,
    unstable_allowCancellation: true,
    stream: async function* (messages, { abortSignal, initialize }) {
      const { externalId } = await initialize();
      if (!externalId) throw new Error("The agent thread could not be created");
      try {
        yield* streamAgentRun({
          threadId: externalId,
          messages,
          signal: abortSignal,
        });
      } finally {
        // A run changes two things the rail shows and the server owns: a new
        // thread's title (taken from the first prompt) and the ordering by last
        // activity. Without this the thread the user is talking in stays labelled
        // "New Chat" until the page is reloaded.
        void runtimeRef.current?.threads.reload();
      }
    },
    load: async (threadId, config) => ({
      messages: await AgentsAPI.threadMessages(threadId, config?.signal),
    }),
  });

  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
