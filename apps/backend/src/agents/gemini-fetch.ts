/**
 * Gemini 3 attaches a `thought_signature` to every function call it emits, and
 * rejects the *next* turn — HTTP 400, `INVALID_ARGUMENT`, "Function call is
 * missing a thought_signature" — unless that signature comes back with the
 * call. It rides on `tool_calls[].extra_content.google`, which is not OpenAI
 * schema: `@langchain/openai` drops it while parsing the response and rebuilds
 * outgoing tool calls from the typed `tool_calls` alone, so a Gemini agent 400s
 * the moment it uses a tool. No released version of that package knows the
 * field exists, which is why the seam is here, at the transport, where the
 * signature is still on the wire.
 *
 * Scope of the cache: only the *most recent* function-call turn needs its
 * signature — Gemini accepts a history whose older calls are bare, verified
 * against the live API — so an in-process map is enough, and a thread resumed
 * in another process (the checkpointer outlives this map) does not 400.
 */

/** Matches the `fetch` shape the `openai` client accepts in `configuration`. */
export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** ponytail: FIFO cap, not an LRU — a run touches a handful of ids, and only
 * the newest turn is ever read back. Raise it if agents grow parallel fan-out. */
const MAX_SIGNATURES = 100;

const SSE_DATA_PREFIX = 'data: ';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Harvest `id → extra_content` out of one completion (streamed or buffered). */
function rememberSignatures(
  store: Map<string, unknown>,
  payload: unknown,
): void {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return;
  for (const choice of payload.choices) {
    if (!isRecord(choice)) continue;
    // `delta` on a stream chunk, `message` on a buffered completion.
    for (const key of ['delta', 'message'] as const) {
      const message = choice[key];
      if (!isRecord(message) || !Array.isArray(message.tool_calls)) continue;
      for (const call of message.tool_calls) {
        if (!isRecord(call)) continue;
        const id = call.id;
        const extra = call.extra_content;
        if (typeof id !== 'string' || !extra) continue;
        store.delete(id);
        store.set(id, extra);
        if (store.size > MAX_SIGNATURES) {
          const oldest = store.keys().next();
          if (!oldest.done) store.delete(oldest.value);
        }
      }
    }
  }
}

/** Put every signature we still hold back on the request that replays its call. */
function restoreSignatures(store: Map<string, unknown>, body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) return body;
  let changed = false;
  for (const message of parsed.messages) {
    if (!isRecord(message) || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (!isRecord(call) || call.extra_content) continue;
      const extra =
        typeof call.id === 'string' ? store.get(call.id) : undefined;
      if (!extra) continue;
      call.extra_content = extra;
      changed = true;
    }
  }
  return changed ? JSON.stringify(parsed) : body;
}

/**
 * Pass the SSE bytes through untouched and read them on the way past. A
 * `TransformStream` rather than `body.tee()`: the reader stays the SDK's, so
 * there is no second branch to drain and no unbounded buffer if it reads slowly.
 */
function sniffStream(
  body: ReadableStream<Uint8Array>,
  store: Map<string, unknown>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffered = '';
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split('\n');
        // A frame can straddle two chunks; the tail is whatever has no newline yet.
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith(SSE_DATA_PREFIX)) continue;
          const data = line.slice(SSE_DATA_PREFIX.length);
          if (data === '[DONE]') continue;
          try {
            rememberSignatures(store, JSON.parse(data));
          } catch {
            // Not a completion frame. Nothing to harvest, nothing to report.
          }
        }
      },
    }),
  );
}

/** Rebuild a response around a new body without inheriting a stale length. */
function respond(body: BodyInit, source: Response): Response {
  const headers = new Headers(source.headers);
  headers.delete('content-length');
  return new Response(body, {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

/**
 * Gemini wraps its error object in a one-element array, which the `openai`
 * SDK renders as the contentless `400 status code (no body)` — the message that
 * hid the thought-signature error in the first place. Unwrap it so the next
 * failure says what it is.
 */
async function unwrapError(response: Response): Promise<Response> {
  const text = await response.text();
  let body = text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length === 1) {
      body = JSON.stringify(parsed[0]);
    }
  } catch {
    // Not JSON. Hand the original text back rather than swallowing it.
  }
  return respond(body, response);
}

export function createGeminiFetch(baseFetch: FetchFn = fetch): FetchFn {
  const signatures = new Map<string, unknown>();

  return async (input, init) => {
    let request = init;
    if (typeof init?.body === 'string') {
      const body = restoreSignatures(signatures, init.body);
      if (body !== init.body) {
        // The body grew; a content-length the SDK computed no longer matches.
        const headers = new Headers(init.headers);
        headers.delete('content-length');
        request = { ...init, body, headers };
      }
    }

    const response = await baseFetch(input, request);
    if (!response.ok) return unwrapError(response);

    if (
      response.body &&
      (response.headers.get('content-type') ?? '').includes('text/event-stream')
    ) {
      return respond(sniffStream(response.body, signatures), response);
    }

    const text = await response.text();
    try {
      rememberSignatures(signatures, JSON.parse(text));
    } catch {
      // Non-JSON success body: nothing to harvest.
    }
    return respond(text, response);
  };
}
