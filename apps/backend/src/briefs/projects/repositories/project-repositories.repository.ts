import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../../databases/kysely';
import type {
  AppDatabase,
  ProjectRepositorySelect,
} from '../../../databases/kysely';

@Injectable()
export class ProjectRepositoriesRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async listByProject(
    projectId: string,
    tx?: AppDatabase,
  ): Promise<ProjectRepositorySelect[]> {
    return this.exec(tx)
      .selectFrom('briefs.projectRepositories')
      .selectAll()
      .where('projectId', '=', projectId)
      .execute();
  }

  async listRepositoryIdsForProjects(
    projectIds: string[],
    tx?: AppDatabase,
  ): Promise<Map<string, string[]>> {
    if (projectIds.length === 0) return new Map();
    const rows = await this.exec(tx)
      .selectFrom('briefs.projectRepositories')
      .select(['projectId', 'repositoryId'])
      .where('projectId', 'in', projectIds)
      .execute();
    const map = new Map<string, string[]>();
    for (const id of projectIds) map.set(id, []);
    for (const r of rows) {
      map.get(r.projectId)?.push(r.repositoryId);
    }
    return map;
  }

  async replaceForProject(
    projectId: string,
    repositoryIds: string[],
    tx?: AppDatabase,
  ): Promise<void> {
    const executor = this.exec(tx);
    await executor
      .deleteFrom('briefs.projectRepositories')
      .where('projectId', '=', projectId)
      .execute();
    if (repositoryIds.length === 0) return;
    await executor
      .insertInto('briefs.projectRepositories')
      .values(
        repositoryIds.map((repositoryId) => ({ projectId, repositoryId })),
      )
      .execute();
  }

  async deleteOne(
    projectId: string,
    repositoryId: string,
    tx?: AppDatabase,
  ): Promise<void> {
    await this.exec(tx)
      .deleteFrom('briefs.projectRepositories')
      .where('projectId', '=', projectId)
      .where('repositoryId', '=', repositoryId)
      .execute();
  }
}
