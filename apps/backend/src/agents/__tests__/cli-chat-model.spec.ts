import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph';
import { createAgent } from 'langchain';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import type {
  LlmClient,
  LlmSettings,
  StructuredParseResult,
  StructuredPromptArgs,
} from '../../common/llm';
import { createCliChatModel } from '../cli-chat-model';

interface AgentTurn {
  text: string;
  toolCalls: Array<{ name: string; argumentsJson: string }>;
}

interface FakeClient {
  client: LlmClient;
  calls: StructuredPromptArgs[];
}

/**
 * Stands in for `AgentCliLlmClient`: the whole surface this adapter uses is
 * `parse()`, and everything below it — the spawn, the gate, the timeout — is
 * already covered by that class's own specs.
 */
function fakeClient(
  script: AgentTurn[] | (() => never),
  usage: { promptTokens: number | null; completionTokens: number | null } = {
    promptTokens: 11,
    completionTokens: 7,
  },
): FakeClient {
  const calls: StructuredPromptArgs[] = [];
  let next = 0;
  const client = {
    parse: (
      _schema: unknown,
      _name: string,
      args: StructuredPromptArgs,
    ): Promise<StructuredParseResult<AgentTurn>> => {
      calls.push(args);
      if (typeof script === 'function') script();
      const parsed = script[Math.min(next, script.length - 1)];
      next += 1;
      return Promise.resolve({
        parsed,
        model: 'sonnet-dated',
        ...usage,
      });
    },
  } as unknown as LlmClient;
  return { client, calls };
}

const SETTINGS: LlmSettings = { provider: 'claude-code', model: 'sonnet' };

const answer = (text: string): AgentTurn[] => [{ text, toolCalls: [] }];

const searchTool = tool(async () => 'ok', {
  name: 'search_commits',
  description: 'Search commits in this organization.',
  schema: z.object({ days: z.number().optional() }),
});

describe('createCliChatModel', () => {
  it('puts every bound tool in the system prompt with its schema', async () => {
    const { client, calls } = fakeClient(answer('done'));
    const model = createCliChatModel(client, SETTINGS);

    await model.bindTools!([searchTool]).invoke([
      new HumanMessage('what shipped?'),
    ]);

    const { systemPrompt } = calls[0];
    expect(systemPrompt).toContain('search_commits');
    expect(systemPrompt).toContain('Search commits in this organization.');
    expect(systemPrompt).toContain('"days"');
    expect(systemPrompt).toContain('argumentsJson');
  });

  it('renders the transcript in order and keeps system messages out of it', async () => {
    const { client, calls } = fakeClient(answer('done'));
    const model = createCliChatModel(client, SETTINGS);

    await model.invoke([
      { role: 'system', content: 'You are DevSummary.' },
      new HumanMessage('what shipped?'),
      new AIMessage({
        content: 'looking',
        tool_calls: [
          {
            id: 'c1',
            name: 'search_commits',
            args: { days: 7 },
            type: 'tool_call',
          },
        ],
      }),
      new ToolMessage({
        content: '{"commits":[]}',
        tool_call_id: 'c1',
        name: 'search_commits',
      }),
      new HumanMessage('and last month?'),
    ]);

    const { systemPrompt, userPrompt } = calls[0];
    expect(systemPrompt).toContain('You are DevSummary.');
    expect(userPrompt).not.toContain('You are DevSummary.');
    expect(userPrompt).toBe(
      [
        '[user] what shipped?',
        '[assistant] looking',
        '→ call search_commits {"days":7}',
        '[tool search_commits (c1)] {"commits":[]}',
        '[user] and last month?',
      ].join('\n'),
    );
  });

  it('turns a toolCalls answer into tool_calls with parsed args and ids', async () => {
    const { client } = fakeClient([
      {
        text: '',
        toolCalls: [
          { name: 'search_commits', argumentsJson: '{"days":30}' },
          { name: 'list_projects', argumentsJson: '{}' },
        ],
      },
    ]);
    const model = createCliChatModel(client, SETTINGS);

    const message = await model.invoke([new HumanMessage('what shipped?')]);

    expect(message.tool_calls).toEqual([
      expect.objectContaining({ name: 'search_commits', args: { days: 30 } }),
      expect.objectContaining({ name: 'list_projects', args: {} }),
    ]);
    const ids = message.tool_calls!.map((c) => c.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(2);
    expect(message.invalid_tool_calls ?? []).toHaveLength(0);
  });

  it('records unparseable arguments instead of throwing, and still calls the tool', async () => {
    const { client } = fakeClient([
      {
        text: '',
        toolCalls: [{ name: 'search_commits', argumentsJson: 'days=30' }],
      },
    ]);
    const model = createCliChatModel(client, SETTINGS);

    const message = await model.invoke([new HumanMessage('what shipped?')]);

    expect(message.invalid_tool_calls).toEqual([
      expect.objectContaining({ name: 'search_commits', args: 'days=30' }),
    ]);
    // Still emitted, so the tool node answers with an error the model reads
    // next turn rather than the loop ending on an empty message.
    expect(message.tool_calls).toEqual([
      expect.objectContaining({ name: 'search_commits', args: {} }),
    ]);
    expect(message.invalid_tool_calls![0].id).toBe(message.tool_calls![0].id);
  });

  it('carries the CLI token counts onto the message', async () => {
    const { client } = fakeClient(answer('done'), {
      promptTokens: 9610,
      completionTokens: 120,
    });
    const message = await createCliChatModel(client, SETTINGS).invoke([
      new HumanMessage('hi'),
    ]);

    expect(message.usage_metadata).toEqual({
      input_tokens: 9610,
      output_tokens: 120,
      total_tokens: 9730,
    });
    expect(message.response_metadata.model).toBe('sonnet-dated');
  });

  it('counts unreported tokens as zero rather than NaN', async () => {
    const { client } = fakeClient(answer('done'), {
      promptTokens: null,
      completionTokens: null,
    });
    const message = await createCliChatModel(client, SETTINGS).invoke([
      new HumanMessage('hi'),
    ]);

    expect(message.usage_metadata).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    });
  });

  it('lets an ApiException out untouched', async () => {
    const { client } = fakeClient(() => {
      throw AppError.OPENAI_NOT_CONFIGURED({
        reason: 'Claude Code is not installed',
      });
    });

    await expect(
      createCliChatModel(client, SETTINGS).invoke([new HumanMessage('hi')]),
    ).rejects.toThrow(/Claude Code is not installed/);
  });

  it('drops the oldest turns when the transcript is too long, keeping the first and last', async () => {
    const { client, calls } = fakeClient(answer('done'));
    const model = createCliChatModel(client, SETTINGS);

    const messages: BaseMessage[] = [new HumanMessage('FIRST QUESTION')];
    for (let i = 0; i < 20; i += 1) {
      messages.push(new AIMessage(`turn-${i} ${'x'.repeat(3000)}`));
    }
    messages.push(new HumanMessage('LAST QUESTION'));

    await model.invoke(messages);

    const { userPrompt } = calls[0];
    expect(userPrompt.length).toBeLessThanOrEqual(30_100);
    expect(userPrompt).toContain('[user] FIRST QUESTION');
    expect(userPrompt).toContain('[… earlier turns omitted]');
    expect(userPrompt).toContain('[user] LAST QUESTION');
    expect(userPrompt).not.toContain('turn-0 ');
    expect(userPrompt).toContain('turn-19 ');
  });

  // The whole point of the class: `createAgent` has to accept it as a chat
  // model, call `bindTools` on it, and drive a real tool loop with it.
  it('drives a createAgent tool loop end to end', async () => {
    const seen: string[] = [];
    const ping = tool(
      async ({ label }: { label: string }) => {
        seen.push(label);
        return `pong:${label}`;
      },
      {
        name: 'ping',
        description: 'Ping with a label.',
        schema: z.object({ label: z.string() }),
      },
    );

    const { client, calls } = fakeClient([
      {
        text: '',
        toolCalls: [{ name: 'ping', argumentsJson: '{"label":"one"}' }],
      },
      { text: 'all done', toolCalls: [] },
    ]);

    const agent = createAgent({
      model: createCliChatModel(client, SETTINGS),
      tools: [ping],
      checkpointer: new MemorySaver(),
    });

    const result = await agent.invoke(
      { messages: [new HumanMessage('ping it')] },
      { configurable: { thread_id: 'thread-1' } },
    );

    expect(seen).toEqual(['one']);
    expect(calls).toHaveLength(2);
    expect(calls[0].systemPrompt).toContain('ping');
    // The second turn sees the tool result in the transcript.
    expect(calls[1].userPrompt).toContain('pong:one');
    const last = result.messages.at(-1)!;
    expect(last.content).toBe('all done');
  });
});
