import { createGeminiFetch, type FetchFn } from '../gemini-fetch';

const SIGNATURE = { google: { thought_signature: 'EusCCugCARFNMg9pI2' } };

function sseResponse(frames: unknown[]): Response {
  const body = frames
    .map((f) => `data: ${JSON.stringify(f)}\n\n`)
    .concat('data: [DONE]\n\n')
    .join('');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function toolCallFrame(id: string): unknown {
  return {
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              id,
              type: 'function',
              extra_content: SIGNATURE,
              function: { name: 'search_commits', arguments: '{"days":2}' },
            },
          ],
        },
      },
    ],
  };
}

async function drain(response: Response): Promise<string> {
  return response.text();
}

interface Recorded {
  bodies: string[];
  fetch: FetchFn;
}

function recorder(responses: Response[]): Recorded {
  const bodies: string[] = [];
  let call = 0;
  return {
    bodies,
    fetch: (_input, init) => {
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      return Promise.resolve(responses[call++]);
    },
  };
}

describe('createGeminiFetch', () => {
  it('replays the thought signature onto the tool call that produced it', async () => {
    const rec = recorder([
      sseResponse([toolCallFrame('call_1')]),
      sseResponse([]),
    ]);
    const geminiFetch = createGeminiFetch(rec.fetch);

    // Turn one: the signature arrives on the stream and must reach the SDK
    // byte-for-byte, since the SDK is the one parsing it.
    const first = await geminiFetch('https://gemini/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(await drain(first)).toContain('thought_signature');

    // Turn two: LangChain rebuilds the assistant message without `extra_content`.
    await geminiFetch('https://gemini/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'search_commits', arguments: '{"days":2}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call_1', content: '{}' },
        ],
      }),
    });

    const sent = JSON.parse(rec.bodies[1]) as {
      messages: { tool_calls?: { extra_content?: unknown }[] }[];
    };
    expect(sent.messages[1].tool_calls?.[0].extra_content).toEqual(SIGNATURE);
  });

  it('leaves an unknown tool call alone', async () => {
    const rec = recorder([sseResponse([])]);
    const body = JSON.stringify({
      messages: [
        {
          role: 'assistant',
          tool_calls: [{ id: 'call_unseen', type: 'function' }],
        },
      ],
    });
    await createGeminiFetch(rec.fetch)('https://gemini/chat/completions', {
      method: 'POST',
      body,
    });
    expect(rec.bodies[0]).toBe(body);
  });

  it('harvests from a signature split across stream chunks', async () => {
    const frame = `data: ${JSON.stringify(toolCallFrame('call_2'))}\n\n`;
    const cut = Math.floor(frame.length / 2);
    const encoder = new TextEncoder();
    const chunked = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(frame.slice(0, cut)));
          controller.enqueue(encoder.encode(frame.slice(cut)));
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
    const rec = recorder([chunked, sseResponse([])]);
    const geminiFetch = createGeminiFetch(rec.fetch);

    await drain(
      await geminiFetch('https://gemini/chat/completions', {
        method: 'POST',
        body: '{}',
      }),
    );
    await geminiFetch('https://gemini/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        messages: [
          {
            role: 'assistant',
            tool_calls: [{ id: 'call_2', type: 'function' }],
          },
        ],
      }),
    });

    expect(rec.bodies[1]).toContain('thought_signature');
  });

  it('unwraps the single-element array Gemini reports errors in', async () => {
    const error = {
      error: { code: 400, message: 'Function call is missing…' },
    };
    const rec = recorder([
      new Response(JSON.stringify([error]), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const response = await createGeminiFetch(rec.fetch)(
      'https://gemini/chat/completions',
      { method: 'POST', body: '{}' },
    );
    expect(response.status).toBe(400);
    expect(JSON.parse(await response.text())).toEqual(error);
  });
});
