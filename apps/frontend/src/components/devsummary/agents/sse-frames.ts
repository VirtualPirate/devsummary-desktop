export interface AgentEvent {
  event: string;
  data: unknown;
}

/**
 * Splits an SSE buffer into whole frames, returning what is left over.
 *
 * Kept pure and separate from the fetch so `sse-frames.check.ts` can run it
 * under plain node — the frontend has no test runner, and a framing bug here
 * looks exactly like a model that answered nothing.
 */
export function parseSseFrames(buffer: string): {
  events: AgentEvent[];
  rest: string;
} {
  const parts = buffer.split("\n\n");
  // The last piece is either empty (the buffer ended on a boundary) or a partial
  // frame that the next read completes. Either way it is not ours yet.
  const rest = parts.pop() ?? "";
  const events: AgentEvent[] = [];

  for (const frame of parts) {
    let name = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      // Multiple data lines in one frame concatenate with a newline (SSE spec).
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length === 0) continue;
    try {
      events.push({ event: name, data: JSON.parse(data.join("\n")) });
    } catch {
      // A frame we cannot parse is dropped rather than aborting the run: the
      // rest of the answer is still worth rendering.
    }
  }

  return { events, rest };
}
