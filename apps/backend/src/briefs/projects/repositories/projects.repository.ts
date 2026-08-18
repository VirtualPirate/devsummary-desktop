import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../../databases/kysely';
import type {
  AppDatabase,
  ProjectInsert,
  ProjectSelect,
  ProjectUpdate,
} from '../../../databases/kysely';

@Injectable()
export class ProjectsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async listByOrganization(
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<ProjectSelect[]> {
    return this.exec(tx)
      .selectFrom('briefs.projects')
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
  ): Promise<ProjectSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('briefs.projects')
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
  ): Promise<ProjectSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('briefs.projects')
      .selectAll()
      .where('organizationId', '=', organizationId)
      .where('name', '=', name)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  async create(input: ProjectInsert, tx?: AppDatabase): Promise<ProjectSelect> {
    return this.exec(tx)
      .insertInto('briefs.projects')
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    patch: ProjectUpdate,
    tx?: AppDatabase,
  ): Promise<ProjectSelect | null> {
    const row = await this.exec(tx)
      .updateTable('briefs.projects')
      .set({ ...patch, updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  async softDelete(id: string, tx?: AppDatabase): Promise<void> {
    await this.exec(tx)
      .updateTable('briefs.projects')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
