import { z } from 'zod';
import { AppError } from '../../errors';
import {
  LlmClient,
  type ProviderResponse,
  type StructuredParseResult,
  type StructuredPromptArgs,
} from '../llm-client';
import type { LlmSettings } from '../llm-config';
import type { AgentCliAdapter, AgentCliRequest } from './agent-cli.adapter';
import { agentCliDetector, type AgentCliDetector } from './agent-cli.detector';
import { runCli, type CliResult, type RunCli } from './run-cli';

// ponytail: fixed cap of 2 and a fixed 120 s; make them settings if users ask.
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 120_000;

/**
 * Two slots, FIFO. A released slot goes straight to the next waiter rather than
 * back to the counter, so a queue can never be starved by a fresh arrival.
 */
class Semaphore {
  private free: number;
  private readonly waiting: Array<() => void> = [];

  constructor(limit: number) {
    this.free = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.free > 0) this.free -= 1;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.free += 1;
    };
  }
}

/**
 * One `LlmClient` for every agent CLI, parameterised by an adapter — so a
 * second CLI is one adapter file and no change here.
 *
 * `parse()` is overridden rather than `request()` implemented, for the same
 * reason `LiveLlmClient` and `UnconfiguredLlmClient` override it: the base
 * template loads the OpenAI SDK and builds a client before it reaches the
 * transport, and there is no SDK and no key on this path. Validation and the
 * result shape still come from the base, via `validate()`.
 */
export class AgentCliLlmClient extends LlmClient {
  private readonly gate = new Semaphore(MAX_CONCURRENT);

  constructor(
    settings: LlmSettings,
    private readonly adapter: AgentCliAdapter,
    private readonly detector: AgentCliDetector = agentCliDetector,
    private readonly run: RunCli = runCli,
  ) {
    super(settings);
  }

  async parse<T>(
    schema: z.ZodType<T>,
    schemaName: string,
    args: StructuredPromptArgs,
  ): Promise<StructuredParseResult<T>> {
    const bin = await this.detector.binaryPath(this.adapter);
    if (!bin) {
      throw AppError.OPENAI_NOT_CONFIGURED({
        reason: `${this.adapter.displayName} is not installed or not on your PATH. ${this.adapter.installHint}`,
      });
    }

    // One request object for both hooks: argv and env must never describe
    // different calls.
    const req: AgentCliRequest = {
      model: this.settings.model,
      systemPrompt: args.systemPrompt,
      // The same call `gemini-schema.ts` makes, without the Gemini pruning.
      jsonSchema: z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }),
      schemaName,
    };
    const argv = this.adapter.buildArgs(req);

    const release = await this.gate.acquire();
    let result: CliResult;
    try {
      result = await this.run(bin, argv, {
        timeoutMs: TIMEOUT_MS,
        // The prompt never goes on argv: diffs reach 60k chars.
        stdin: args.userPrompt,
        env: this.adapter.env?.(req),
      });
    } catch (err) {
      throw AppError.OPENAI_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      release();
    }

    if (result.timedOut) {
      throw AppError.OPENAI_API_FAILED({
        reason: `timed out after ${TIMEOUT_MS / 1000}s`,
      });
    }

    const output = this.adapter.parseOutput(result);
    if (!output.ok) {
      // The adapter already drew the line between a failed process and a
      // usable one that answered badly; keeping it is what stops a malformed
      // body from being retried as a network fault.
      throw output.kind === 'transport'
        ? AppError.OPENAI_API_FAILED({ reason: output.reason })
        : AppError.OPENAI_RESPONSE_INVALID({ reason: output.reason });
    }

    return this.validate(schema, {
      raw: output.raw,
      model: output.model,
      promptTokens: output.promptTokens,
      completionTokens: output.completionTokens,
    });
  }

  /** Unreachable: `parse()` never reaches the base template. */
  protected request(): Promise<ProviderResponse> {
    return Promise.reject(AppError.OPENAI_NOT_CONFIGURED());
  }
}
