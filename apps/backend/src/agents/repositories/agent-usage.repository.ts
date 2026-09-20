import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../databases/kysely';
import type { AppDatabase } from '../../databases/kysely';

export interface InsertAgentUsageInput {
  organizationId: string;
  sessionId: string;
  userId: string;
  model: string;
}

@Injectable()
export class AgentUsageRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  async insert(input: InsertAgentUsageInput): Promise<{ id: string }> {
    return this.db
      .insertInto('agents.usage')
      .values(input)
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  async recordTokens(
    id: string,
    promptTokens: number | null,
    completionTokens: number | null,
  ): Promise<void> {
    await this.db
      .updateTable('agents.usage')
      .set({ promptTokens, completionTokens })
      .where('id', '=', id)
      .execute();
  }
}
