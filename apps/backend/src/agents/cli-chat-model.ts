import { randomUUID } from 'node:crypto';
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  type BaseMessage,
  type InvalidToolCall,
  type ToolCall,
} from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { z } from 'zod';
import type { LlmClient, LlmSettings } from '../common/llm';

/**
 * What the CLI must answer with. `argumentsJson` is a **string** rather than an
 * open object because the CLIs disagree about open-ended schemas — codex runs
 * the answer through OpenAI strict mode, which rejects an object with no
 * declared properties outright, and a union of every tool's argument shape
 * would have to be rebuilt per call. One string parsed on this side costs a
 * `JSON.parse` and works on all four.
 */
const AgentTurnSchema = z.object({
  text: z.string(),
  toolCalls: z.array(z.object({ name: z.string(), argumentsJson: z.string() })),
});

/**
 * The transcript is re-sent in full on every turn (the CLI is stateless), so it
 * has to be bounded. Same figure and same reason as `BRIEFS_MAX_PROMPT_CHARS`.
 */
const MAX_TRANSCRIPT_CHARS = 30_000;

const OMITTED_MARKER = '[… earlier turns omitted]';

interface ToolSpec {
  name: string;
  description: string;
  parameters: unknown;
}

export interface CliChatModelCallOptions extends BaseChatModelCallOptions {
  /** Written by `bindTools` through `withConfig`, read by `_generate`. */
  tools?: BindToolsInput[];
}

/** Text out of either content shape. Non-text parts have no textual form. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      const p = part as { type?: string; text?: string };
      return p?.type === 'text' && typeof p.text === 'string' ? p.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function toToolSpec(tool: BindToolsInput): ToolSpec {
  // Handles a LangChain tool (Zod schema -> JSON Schema) and an already-OpenAI
  // tool definition alike, by duck typing rather than `instanceof` — pnpm
  // resolves two copies of `@langchain/core` here (see `agent-wire.ts`).
  const fn = convertToOpenAITool(
    tool as Parameters<typeof convertToOpenAITool>[0],
  ).function;
  return {
    name: fn.name,
    description: fn.description ?? '',
    parameters: fn.parameters ?? { type: 'object', properties: {} },
  };
}

/**
 * The caller's own system message(s), then the tool catalogue, then the output
 * contract. The CLI has no tool-calling protocol of its own — it answers one
 * JSON object — so "call a tool" has to be something the model can *say*.
 */
function buildSystemPrompt(messages: BaseMessage[], tools: ToolSpec[]): string {
  const sections: string[] = [];

  const system = messages
    .filter((m) => m.getType() === 'system')
    .map((m) => textOf(m.content))
    .filter((t) => t.trim().length > 0);
  if (system.length > 0) sections.push(system.join('\n\n'));

  if (tools.length > 0) {
    sections.push(
      [
        '# Tools',
        '',
        'You can call these tools to answer the user. Each one takes a JSON object of arguments matching its schema.',
        '',
        ...tools.map((tool) =>
          [
            `## ${tool.name}`,
            tool.description,
            `Arguments schema: ${JSON.stringify(tool.parameters)}`,
          ]
            .filter(Boolean)
            .join('\n'),
        ),
      ].join('\n'),
    );
  }

  sections.push(
    [
      '# Answering',
      '',
      'Answer with a single JSON object matching the required output schema.',
      '',
      `- When you have the answer, put it in "text" and leave "toolCalls" as an empty array.${
        tools.length > 0
          ? ' Never invent a tool name — only the tools listed above exist.'
          : ''
      }`,
      ...(tools.length > 0
        ? [
            '- When you need a tool, list one or more entries in "toolCalls". Each entry\'s "name" is the tool name and its "argumentsJson" is a JSON **string** holding an object that matches that tool\'s schema (for example "{\\"days\\":30}", or "{}" when it takes none).',
            '- When you call tools, leave "text" empty or use it for a one-line note about what you are doing. Their results come back on the next turn.',
          ]
        : []),
    ].join('\n'),
  );

  return sections.join('\n\n');
}

function renderMessage(message: BaseMessage): string {
  const type = message.getType();
  const content = textOf(message.content);
  const extra = message as unknown as {
    tool_calls?: ToolCall[];
    tool_call_id?: string;
  };

  if (type === 'human') return `[user] ${content}`;
  if (type === 'tool') {
    return `[tool ${message.name ?? 'unknown'} (${extra.tool_call_id ?? '-'})] ${content}`;
  }
  if (type === 'ai') {
    const calls = (extra.tool_calls ?? []).map(
      (call) => `→ call ${call.name} ${JSON.stringify(call.args ?? {})}`,
    );
    return [`[assistant] ${content}`, ...calls].join('\n');
  }
  return `[${type}] ${content}`;
}

/**
 * Drop whole turns from the middle, oldest first. The first user message is the
 * question the whole thread is about and the last message is what the model has
 * to react to, so neither is ever a candidate.
 */
function clampTranscript(lines: string[]): string[] {
  const size = (ls: string[]) => ls.reduce((n, l) => n + l.length + 1, 0);
  if (lines.length < 3 || size(lines) <= MAX_TRANSCRIPT_CHARS) return lines;

  let total = size(lines) + OMITTED_MARKER.length + 1;
  let first = 1;
  while (total > MAX_TRANSCRIPT_CHARS && first < lines.length - 1) {
    total -= lines[first].length + 1;
    first += 1;
  }
  return [lines[0], OMITTED_MARKER, ...lines.slice(first)];
}

function buildTranscript(messages: BaseMessage[]): string {
  const lines = messages
    .filter((m) => m.getType() !== 'system')
    .map(renderMessage);
  return clampTranscript(lines).join('\n');
}

/**
 * A LangChain chat model over one of the four agent CLIs, built on this repo's
 * `LlmClient.parse()` structured-output seam.
 *
 * The CLIs are spawned binaries with no chat API and no tool-calling protocol:
 * one process, a prompt on stdin, one JSON object on stdout. So every turn is
 * one `parse()` call carrying the **whole** conversation — there is no session
 * to append to — and the tool loop is emulated by asking the model to name the
 * tool it wants in that JSON. LangGraph does the rest: it sees `tool_calls` on
 * the `AIMessage`, runs the tools, appends their results and calls again.
 *
 * Everything spawn-side — binary detection, the concurrency gate, scratch
 * files, the 120 s timeout, token accounting, the error mapping — already lives
 * in `AgentCliLlmClient`, so nothing here starts a process.
 *
 * Not implemented: `_streamResponseChunks`. A CLI answers once, at the end, so
 * there is nothing to stream; `BaseChatModel._streamIterator` falls back to
 * `invoke` and LangGraph's `updates` mode still carries the finished message.
 * The method must nonetheless stay *present on the prototype* — `langchain`'s
 * `isBaseChatModel` probes `"_streamResponseChunks" in model` before it will
 * call `bindTools`, and the base class provides it.
 */
class CliChatModel extends BaseChatModel<CliChatModelCallOptions> {
  constructor(
    private readonly client: LlmClient,
    private readonly llm: LlmSettings,
  ) {
    super({});
  }

  _llmType(): string {
    return 'devsummary-cli';
  }

  invocationParams(): Record<string, unknown> {
    return { provider: this.llm.provider, model: this.llm.model };
  }

  _identifyingParams(): Record<string, unknown> {
    return this.invocationParams();
  }

  /**
   * The pattern every `BaseChatModel` uses: tools go into the call options
   * through `withConfig`, and `_generate` reads them back off `options`. The
   * agent binds on every turn, so this must not mutate `this`.
   */
  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<CliChatModelCallOptions>,
  ) {
    return this.withConfig({ tools, ...kwargs });
  }

  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): Promise<ChatResult> {
    const tools = (options.tools ?? []).map(toToolSpec);

    // `ApiException`s — `OPENAI_NOT_CONFIGURED` for a missing binary above all
    // — travel out untouched, so the SSE error frame carries the install hint.
    const result = await this.client.parse(AgentTurnSchema, 'agent_turn', {
      systemPrompt: buildSystemPrompt(messages, tools),
      userPrompt: buildTranscript(messages),
    });

    const toolCalls: ToolCall[] = [];
    const invalidToolCalls: InvalidToolCall[] = [];
    for (const call of result.parsed.toolCalls) {
      // The wire format and assistant-ui both key on the id, and a CLI has no
      // notion of one.
      const id = randomUUID();
      let args: Record<string, unknown> | null = null;
      try {
        args = JSON.parse(call.argumentsJson) as Record<string, unknown>;
      } catch (err) {
        invalidToolCalls.push({
          id,
          name: call.name,
          args: call.argumentsJson,
          error: err instanceof Error ? err.message : 'Unparseable arguments',
          type: 'invalid_tool_call',
        });
      }
      // Emitted either way: the tool node is what turns a bad call into a
      // `ToolMessage` the model reads on its next turn. Dropping it instead
      // ends the loop on an empty answer with nothing saying why.
      toolCalls.push({
        id,
        name: call.name,
        args: args && typeof args === 'object' ? args : {},
        type: 'tool_call',
      });
    }

    const inputTokens = result.promptTokens ?? 0;
    const outputTokens = result.completionTokens ?? 0;

    const message = new AIMessage({
      content: result.parsed.text,
      tool_calls: toolCalls,
      ...(invalidToolCalls.length > 0
        ? { invalid_tool_calls: invalidToolCalls }
        : {}),
      usage_metadata: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      response_metadata: { model: result.model },
    });

    return {
      generations: [{ text: result.parsed.text, message }],
      // The shape `ChatOpenAI` reports, for anything reading `llmOutput`
      // instead of the message. `AgentGraphService` reads `usage_metadata`.
      llmOutput: {
        tokenUsage: {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      },
    };
  }
}

export function createCliChatModel(
  client: LlmClient,
  settings: LlmSettings,
): BaseChatModel {
  return new CliChatModel(client, settings);
}
