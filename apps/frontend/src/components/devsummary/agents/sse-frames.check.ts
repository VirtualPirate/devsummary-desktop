/**
 * Run with: node --experimental-strip-types src/components/devsummary/agents/sse-frames.check.ts
 *
 * The frontend has no test runner. What is pinned here is the framing: a frame
 * split across two reads, or an `event:` name dropped, renders as an answer that
 * never arrives, with nothing logged anywhere.
 */
import assert from "node:assert/strict";
import { parseSseFrames } from "./sse-frames.ts";

// A whole frame, and a partial one that must be held back.
{
  const { events, rest } = parseSseFrames(
    'event: messages\ndata: [{"type":"AIMessageChunk"},{}]\n\nevent: upda',
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "messages");
  assert.deepEqual(events[0].data, [{ type: "AIMessageChunk" }, {}]);
  assert.equal(rest, "event: upda");
}

// The held-back remainder completes on the next read.
{
  const first = parseSseFrames('event: updates\ndata: {"model":');
  assert.deepEqual(first.events, []);
  const second = parseSseFrames(`${first.rest}{"messages":[]}}\n\n`);
  assert.equal(second.events.length, 1);
  assert.deepEqual(second.events[0], {
    event: "updates",
    data: { model: { messages: [] } },
  });
  assert.equal(second.rest, "");
}

// A frame with no data line carries nothing; unparseable JSON is dropped rather
// than killing the run that follows it.
{
  const { events } = parseSseFrames(
    ': keep-alive\n\nevent: messages\ndata: {oops\n\nevent: updates\ndata: {"a":1}\n\n',
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "updates");
}

// Multiple data lines in one frame join with a newline, per the SSE spec.
{
  const { events } = parseSseFrames('event: updates\ndata: {"a":\ndata: 1}\n\n');
  assert.deepEqual(events[0].data, { a: 1 });
}

console.log("sse-frames: ok");
