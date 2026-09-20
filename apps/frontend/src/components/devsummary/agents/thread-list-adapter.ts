import type { RemoteThreadListAdapter } from "@assistant-ui/react";
import { AgentsAPI } from "@/api/agents.api";

/**
 * Backs the thread rail with this organization's own rows.
 *
 * Without it the runtime keeps the thread list in memory only, so every reload
 * starts an empty conversation and the sidebar forgets everything the user
 * asked. The ids here are ours: the row id is also the LangGraph thread id the
 * run and the history endpoints take, so `remoteId` and `externalId` are the
 * same value and there is nothing to reconcile.
 */
export const agentThreadListAdapter: RemoteThreadListAdapter = {
  list: async () => ({
    threads: (await AgentsAPI.listThreads()).map((thread) => ({
      status: "regular" as const,
      remoteId: thread.id,
      externalId: thread.id,
      title: thread.title ?? undefined,
      lastMessageAt: new Date(thread.updatedAt),
    })),
  }),

  // Created lazily, on the first message: the runtime calls this through the
  // `initialize` it hands the stream callback. Nothing is written for a thread
  // the user opens and abandons.
  initialize: async () => {
    const thread = await AgentsAPI.createThread();
    return { remoteId: thread.id, externalId: thread.id };
  },

  rename: async (remoteId, title) => {
    await AgentsAPI.renameThread(remoteId, title);
  },

  delete: async (remoteId) => {
    await AgentsAPI.deleteThread(remoteId);
  },

  // Archiving is not a state a thread can be in here, and the rail exposes no
  // control for it. Deleting is a soft delete already.
  archive: async () => {},
  unarchive: async () => {},

  fetch: async (threadId) => {
    const thread = (await AgentsAPI.listThreads()).find((t) => t.id === threadId);
    if (!thread) throw new Error("Thread not found");
    return {
      status: "regular",
      remoteId: thread.id,
      externalId: thread.id,
      title: thread.title ?? undefined,
      lastMessageAt: new Date(thread.updatedAt),
    };
  },

  // The title is written server-side from the first prompt, which is both
  // cheaper and a better label than a second model call summarizing one message.
  generateTitle: async () =>
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
};
