import {
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';

/**
 * The wire shape `@assistant-ui/react-langgraph` reads, and the reason this file
 * exists: a LangChain message serializes itself as a LangChain *constructor*
 * envelope (`{lc: 1, type: "constructor", kwargs: {...}}`), which the adapter
 * does not understand at all. It wants the LangGraph Platform's shape — a flat
 * object whose `type` is `human` / `ai` / `tool` / `AIMessageChunk`. Sending the
 * class's own JSON renders an empty thread with no error anywhere.
 */
export interface WireMessage {
  id?: string;
  type: string;
  content: unknown;
  tool_calls?: unknown[];
  tool_call_chunks?: unknown[];
  tool_call_id?: string;
  name?: string;
  status?: string;
}

/**
 * **Nothing here may use `instanceof`.** pnpm resolves two copies of
 * `@langchain/core` (deepagents pins its own peer set), so the messages coming
 * off the stream are built by a different copy of the classes this file can
 * import, and every `instanceof` against them is false. It fails silently and
 * expensively: chunks came through labelled `ai`, so the client replaced the
 * answer on every token instead of appending, and tool results arrived with no
 * `tool_call_id`, so the chart tool had nothing to attach a result to and never
 * rendered. `getType()` and property presence are the same across copies.
 *
 * @param chunk whether this is a streaming delta rather than a finished message.
 *   It cannot be detected either: the checkpointer stores the accumulated answer
 *   as an `AIMessageChunk` too, so a thread reloaded from history would come back
 *   looking like a stream of deltas. Only the caller knows which it is.
 */
export function toWireMessage(
  message: BaseMessage,
  { chunk = false }: { chunk?: boolean } = {},
): WireMessage {
  const type = message.getType();
  const extra = message as unknown as {
    tool_calls?: unknown[];
    tool_call_chunks?: unknown[];
    tool_call_id?: string;
    status?: string;
  };

  const wire: WireMessage = {
    id: message.id,
    // A delta must say so: the adapter appends `AIMessageChunk` onto the message
    // it is streaming and replaces on anything else.
    type: chunk && type === 'ai' ? 'AIMessageChunk' : type,
    content: message.content,
  };

  if (chunk && type === 'ai') {
    if (extra.tool_call_chunks?.length) {
      wire.tool_call_chunks = extra.tool_call_chunks;
    }
  } else if (extra.tool_calls?.length) {
    wire.tool_calls = extra.tool_calls;
  }

  if (type === 'tool') {
    wire.tool_call_id = extra.tool_call_id;
    wire.name = message.name;
    wire.status = extra.status ?? 'success';
  }

  return wire;
}

export interface IncomingMessage {
  id?: string;
  type?: string;
  content?: unknown;
  tool_call_id?: string;
  name?: string;
}

/**
 * The composer's own messages, coming back the other way. Only the two kinds the
 * browser is allowed to author are accepted: a prompt, and a result for a tool
 * call the UI ran itself. Anything else — a fabricated `ai` turn, a `system`
 * override — is dropped rather than trusted.
 */
export function fromWireMessages(messages: IncomingMessage[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const message of messages) {
    const content =
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content ?? '');
    if (message.type === 'human') {
      out.push(new HumanMessage({ id: message.id, content }));
    } else if (message.type === 'tool' && message.tool_call_id) {
      out.push(
        new ToolMessage({
          id: message.id,
          content,
          tool_call_id: message.tool_call_id,
          name: message.name,
        }),
      );
    }
  }
  return out;
}
