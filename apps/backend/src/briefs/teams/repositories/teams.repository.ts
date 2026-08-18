import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../../databases/kysely';
import type {
  AppDatabase,
  TeamInsert,
  TeamSelect,
  TeamUpdate,
} from '../../../databases/kysely';

@Injectable()
export class TeamsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async listByOrganization(
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<TeamSelect[]> {
    return this.exec(tx)
      .selectFrom('briefs.teams')
      .selectAll()
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  async findByIdScopedToOrg(
    id: string,
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<TeamSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('briefs.teams')
      .selectAll()
      .where('id', '=', id)
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  async findByNameInOrg(
    organizationId: string,
    name: string,
    tx?: AppDatabase,
  ): Promise<TeamSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('briefs.teams')
      .selectAll()
      .where('organizationId', '=', organizationId)
      .where('name', '=', name)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  async create(input: TeamInsert, tx?: AppDatabase): Promise<TeamSelect> {
    return this.exec(tx)
      .insertInto('briefs.teams')
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    patch: TeamUpdate,
    tx?: AppDatabase,
  ): Promise<TeamSelect | null> {
    const row = await this.exec(tx)
      .updateTable('briefs.teams')
      .set({ ...patch, updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  async softDelete(id: string, tx?: AppDatabase): Promise<void> {
    await this.exec(tx)
      .updateTable('briefs.teams')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
