import { getAppConfig } from "@/env/config-env";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";
import type { AgentMessage } from "@/api/agents.api";
import { parseSseFrames, type AgentEvent } from "./sse-frames";

export async function* streamAgentRun(input: {
  threadId: string;
  messages: AgentMessage[];
  signal: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const { activeOrganizationId } = useActiveOrganizationStore.getState();
  if (!activeOrganizationId) {
    throw new Error("No active organization; cannot reach the agent");
  }

  const app = getAppConfig();
  const response = await fetch(
    `${app.baseURL}/api/agents/threads/${input.threadId}/stream`,
    {
      method: "POST",
      // This is the axios request interceptor's job (`api/axios-client.ts`),
      // redone by hand for a request axios cannot stream. Same two headers,
      // same names: without the per-boot token `LocalTokenGuard` answers 401.
      headers: {
        "content-type": "application/json",
        "x-desktop-token": app.token,
        "X-Organization-Id": activeOrganizationId,
      },
      body: JSON.stringify({ messages: input.messages }),
      signal: input.signal,
    },
  );

  if (!response.ok || !response.body) {
    // Every non-stream failure here is an `ApiError` body — a deleted thread
    // (404), an unconfigured provider (OPENAI_NOT_CONFIGURED), a missing token
    // (401). Its message says which; the status alone said "unavailable" for
    // all of them and left the user with nothing to act on.
    const body = (await response.json().catch(() => null)) as {
      message?: unknown;
    } | null;
    throw new Error(
      typeof body?.message === "string" && body.message
        ? body.message
        : `The agent is unavailable (${response.status})`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseFrames(buffer);
      buffer = rest;
      for (const event of events) yield event;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
