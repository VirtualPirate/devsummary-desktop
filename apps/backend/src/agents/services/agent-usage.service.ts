import { Injectable } from '@nestjs/common';
import type { AgentsConfig } from '../agents.config';
import { AgentUsageRepository } from '../repositories/agent-usage.repository';

export interface ReserveInput {
  organizationId: string;
  sessionId: string;
  userId: string;
}

/**
 * Token accounting for agent runs, and nothing else.
 *
 * The cloud original counted these rows against a per-tenant daily cap, which is
 * why the row is written *before* the model runs. There is no cap on a
 * single-user install — the provider key is the user's own and nothing here
 * meters it for them — but the write order is kept: a run that dies halfway, or
 * whose token counts cannot be parsed, still leaves a row saying it happened.
 */
@Injectable()
export class AgentUsageService {
  constructor(
    private readonly usage: AgentUsageRepository,
    private readonly config: AgentsConfig,
  ) {}

  async reserve(input: ReserveInput): Promise<string> {
    const row = await this.usage.insert({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      userId: input.userId,
      // The column is NOT NULL and the run is about to fail with
      // OPENAI_NOT_CONFIGURED anyway; recording that is more use than a blank.
      model: this.config.llm?.model ?? 'unconfigured',
    });
    return row.id;
  }

  async settle(
    usageId: string,
    tokens: { promptTokens: number | null; completionTokens: number | null },
  ): Promise<void> {
    await this.usage.recordTokens(
      usageId,
      tokens.promptTokens,
      tokens.completionTokens,
    );
  }
}
