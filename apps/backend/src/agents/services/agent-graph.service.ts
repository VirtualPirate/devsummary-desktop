import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { createDeepAgent } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type pg from 'pg';
import { AnalyticsService } from '../../analytics/services/analytics.service';
import { AppError } from '../../common/errors';
import { createLlmClient, isAgentProvider } from '../../common/llm';
import type { LlmSettings } from '../../common/llm';
import { KYSELY_DB, type AppDatabase } from '../../databases/kysely';
import { createPglitePool } from '../../databases/kysely/pglite-pool';
import { CollaboratorsRepository } from '../../integrations/github/collaborators/repositories/collaborators.repository';
import { AgentDataRepository } from '../repositories/agent-data.repository';
import { AGENT_SYSTEM_PROMPT } from '../agent-prompt';
import { buildAgentTools } from '../agent-tools';
import { createCliChatModel } from '../cli-chat-model';
import { createGeminiFetch } from '../gemini-fetch';
import { toWireMessage, type WireMessage } from '../agent-wire';
import { type AgentsConfig } from '../agents.config';

/** One SSE frame, in the shape `@assistant-ui/react-langgraph` consumes. */
export interface AgentStreamEvent {
  event: 'messages' | 'updates' | 'error';
  data: unknown;
}

export interface RunTokens {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface RunInput {
  organizationId: string;
  threadId: string;
  messages: BaseMessage[];
  signal: AbortSignal;
  /** Filled as the run goes, so the caller can settle usage after it ends. */
  tokens: RunTokens;
}

interface MessageState {
  messages?: BaseMessage[];
}

function isMessageState(value: unknown): value is MessageState {
  return typeof value === 'object' && value !== null && 'messages' in value;
}

@Injectable()
export class AgentGraphService implements OnModuleDestroy {
  private model?: { key: string; model: BaseChatModel };
  private checkpointer?: Promise<PostgresSaver>;
  private saver?: PostgresSaver;

  constructor(
    private readonly config: AgentsConfig,
    private readonly data: AgentDataRepository,
    private readonly collaborators: CollaboratorsRepository,
    private readonly analytics: AnalyticsService,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
  ) {}

  async onModuleDestroy(): Promise<void> {
    // `end()` is a no-op on the shim — the app owns the PGlite handle and
    // KyselyModule closes it — but calling it keeps the saver's own lifecycle
    // honest if it ever grows something else to release.
    await this.saver?.end();
  }

  /**
   * The provider is resolved **per run**, not once at boot: the AI settings page
   * writes `LLM_PROVIDER`, the key and the model override into `process.env`
   * mid-session, and a model built in the constructor would pin whatever was
   * configured at launch. The built model is cached while
   * `[provider, apiKey, model]` is unchanged, exactly like `LiveLlmClient` —
   * otherwise every run would construct a new SDK client.
   *
   * OpenAI and Gemini are one class: Gemini answers on an OpenAI-compatible
   * endpoint, so the provider is a base URL and a key rather than a second SDK.
   * `apiKey` is passed explicitly rather than left to the ambient
   * `OPENAI_API_KEY`, or a Gemini-configured agent would silently bill OpenAI.
   * The four agent CLIs are not an SDK at all — they are spawned binaries — and
   * reach LangChain through `createCliChatModel` over this repo's `LlmClient`.
   */
  private getModel(): BaseChatModel {
    const settings = this.config.llm;
    if (!settings) throw AppError.OPENAI_NOT_CONFIGURED();

    const key = JSON.stringify([
      settings.provider,
      settings.apiKey,
      settings.model,
    ]);
    if (this.model?.key !== key) {
      this.model = { key, model: buildModel(settings) };
    }
    return this.model.model;
  }

  private getCheckpointer(): Promise<PostgresSaver> {
    this.checkpointer ??= (async () => {
      const saver = new PostgresSaver(
        // The whole pool surface the saver uses, over the app's own PGlite —
        // there is no connection string to hand `fromConnString` here.
        createPglitePool(this.db) as unknown as pg.Pool,
        undefined,
        // Its own tables, in the schema that already owns the thread rows.
        // `setup()` is idempotent and runs its own migrations.
        { schema: 'agents' },
      );
      await saver.setup();
      this.saver = saver;
      return saver;
    })();
    return this.checkpointer;
  }

  /**
   * A fresh agent per run. Building one is object construction — no model call,
   * no connection — and it is what lets the tools close over a single
   * organization id instead of reading one out of per-call config. A graph shared
   * between workspaces is one plumbing mistake away from answering with another
   * workspace's commits.
   */
  private async buildAgent(organizationId: string) {
    const checkpointer = await this.getCheckpointer();
    return createDeepAgent({
      model: this.getModel(),
      checkpointer,
      systemPrompt: AGENT_SYSTEM_PROMPT,
      tools: buildAgentTools(organizationId, {
        data: this.data,
        collaborators: this.collaborators,
        analytics: this.analytics,
      }),
    });
  }

  async *run(input: RunInput): AsyncGenerator<AgentStreamEvent> {
    const agent = await this.buildAgent(input.organizationId);

    const stream = await agent.stream(
      { messages: input.messages },
      {
        configurable: { thread_id: input.threadId },
        // `messages` carries the tokens as they are generated; `updates` carries
        // the finished messages, which is the only place a tool result appears.
        // The client accumulates both by message id, so the overlap is free.
        streamMode: ['messages', 'updates'],
        signal: input.signal,
        recursionLimit: 50,
      },
    );

    for await (const [mode, chunk] of stream as AsyncIterable<
      [string, unknown]
    >) {
      if (mode === 'messages') {
        const [message, metadata] = chunk as [BaseMessage, unknown];
        yield {
          event: 'messages',
          data: [toWireMessage(message, { chunk: true }), metadata],
        };
        continue;
      }
      // Project the node's state update down to its messages. The rest of a deep
      // agent's state is its virtual filesystem and todo list, which the client
      // has no renderer for and which can be far larger than the answer.
      const updates: Record<string, { messages: WireMessage[] }> = {};
      for (const [node, value] of Object.entries(
        (chunk ?? {}) as Record<string, unknown>,
      )) {
        if (!isMessageState(value) || !Array.isArray(value.messages)) continue;
        updates[node] = {
          messages: value.messages.map((m) => toWireMessage(m)),
        };
        this.accumulateTokens(input.tokens, value.messages);
      }
      if (Object.keys(updates).length > 0) {
        yield { event: 'updates', data: updates };
      }
    }
  }

  private accumulateTokens(tokens: RunTokens, messages: BaseMessage[]): void {
    for (const message of messages) {
      const usage = (
        message as {
          usage_metadata?: { input_tokens?: number; output_tokens?: number };
        }
      ).usage_metadata;
      if (!usage) continue;
      tokens.promptTokens =
        (tokens.promptTokens ?? 0) + (usage.input_tokens ?? 0);
      tokens.completionTokens =
        (tokens.completionTokens ?? 0) + (usage.output_tokens ?? 0);
    }
  }

  /** The thread's stored history, for a reload or a switch back to it. */
  async history(
    organizationId: string,
    threadId: string,
  ): Promise<WireMessage[]> {
    const agent = await this.buildAgent(organizationId);
    // `getState` is declared against the agent's inferred state, which a deep
    // agent assembles from its middleware and which resolves to `never` here;
    // the messages channel is the only part of it this reads. The cast is on the
    // call rather than the method so `this` stays bound.
    const state = await (agent.getState({
      configurable: { thread_id: threadId },
    }) as Promise<{ values?: MessageState }>);
    const messages = state.values?.messages ?? [];
    return messages.map((m) => toWireMessage(m));
  }
}

function buildModel(settings: LlmSettings): BaseChatModel {
  if (isAgentProvider(settings.provider)) {
    return createCliChatModel(createLlmClient(settings), settings);
  }
  return new ChatOpenAI({
    model: settings.model,
    apiKey: settings.apiKey,
    ...(settings.baseURL
      ? {
          configuration: {
            baseURL: settings.baseURL,
            // Gemini 3 refuses a tool loop whose function calls come back
            // without their thought signatures, and `@langchain/openai` drops
            // them. See `gemini-fetch.ts`.
            ...(settings.provider === 'gemini'
              ? { fetch: createGeminiFetch() }
              : {}),
          },
        }
      : {}),
  });
}
