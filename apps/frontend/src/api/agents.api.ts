import type { LangChainMessage } from "@assistant-ui/react-langgraph";
import type { ApiResponse } from "@launchstack/api-interfaces";
import { axiosInstance } from "./axios-client";

const BASE = "/api/agents/threads";

export interface AgentThread {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A stored message. The backend serializes its LangChain messages into exactly
 * this shape (see `agent-wire.ts`), so the adapter's own type is the contract —
 * anything looser here just moves the mismatch to where it renders nothing.
 */
export type AgentMessage = LangChainMessage;

export const AgentsAPI = {
  listThreads: async (): Promise<AgentThread[]> => {
    const response = await axiosInstance.request({ url: BASE, method: "GET" });
    return (response.data as ApiResponse<AgentThread[]>).data;
  },

  createThread: async (): Promise<AgentThread> => {
    const response = await axiosInstance.request({ url: BASE, method: "POST" });
    return (response.data as ApiResponse<AgentThread>).data;
  },

  renameThread: async (threadId: string, title: string): Promise<void> => {
    await axiosInstance.request({
      url: `${BASE}/${threadId}`,
      method: "PATCH",
      data: { title },
    });
  },

  deleteThread: async (threadId: string): Promise<void> => {
    await axiosInstance.request({ url: `${BASE}/${threadId}`, method: "DELETE" });
  },

  threadMessages: async (
    threadId: string,
    signal?: AbortSignal,
  ): Promise<AgentMessage[]> => {
    const response = await axiosInstance.request({
      url: `${BASE}/${threadId}/messages`,
      method: "GET",
      signal,
    });
    return (response.data as ApiResponse<AgentMessage[]>).data;
  },
};
