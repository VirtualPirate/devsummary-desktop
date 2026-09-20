import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../databases/kysely';
import type { AgentSessionSelect, AppDatabase } from '../../databases/kysely';

export interface CreateAgentSessionInput {
  organizationId: string;
  createdBy: string;
  title: string | null;
}

@Injectable()
export class AgentSessionsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  async listByOrganization(
    organizationId: string,
  ): Promise<AgentSessionSelect[]> {
    return this.db
      .selectFrom('agents.sessions')
      .selectAll()
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .orderBy('updatedAt', 'desc')
      .execute();
  }

  async findByIdScopedToOrg(
    id: string,
    organizationId: string,
  ): Promise<AgentSessionSelect | null> {
    const row = await this.db
      .selectFrom('agents.sessions')
      .selectAll()
      .where('id', '=', id)
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  async create(input: CreateAgentSessionInput): Promise<AgentSessionSelect> {
    return this.db
      .insertInto('agents.sessions')
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async touch(id: string): Promise<void> {
    await this.db
      .updateTable('agents.sessions')
      .set({ updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async rename(
    id: string,
    organizationId: string,
    title: string,
  ): Promise<AgentSessionSelect | null> {
    const row = await this.db
      .updateTable('agents.sessions')
      .set({ title, updatedAt: new Date() })
      .where('id', '=', id)
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  async softDelete(id: string, organizationId: string): Promise<void> {
    await this.db
      .updateTable('agents.sessions')
      .set({ deletedAt: new Date() })
      .where('id', '=', id)
      .where('organizationId', '=', organizationId)
      .execute();
  }
}
