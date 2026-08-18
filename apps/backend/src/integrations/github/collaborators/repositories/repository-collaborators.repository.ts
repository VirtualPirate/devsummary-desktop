import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../../../databases/kysely';
import type { AppDatabase } from '../../../../databases/kysely';

export interface UpsertRepoCollaboratorInput {
  repositoryId: string;
  collaboratorId: string;
  roleName: string;
  permissionAdmin: boolean;
  permissionMaintain: boolean;
  permissionPush: boolean;
  permissionTriage: boolean;
  permissionPull: boolean;
  raw: unknown;
}

export interface ActiveRepoCollaboratorRow {
  joinId: string;
  collaboratorId: string;
  githubUserId: bigint;
  login: string;
  avatarUrl: string | null;
  htmlUrl: string | null;
  type: string | null;
  siteAdmin: boolean;
  roleName: string;
  permissionAdmin: boolean;
  permissionMaintain: boolean;
  permissionPush: boolean;
  permissionTriage: boolean;
  permissionPull: boolean;
  updatedAt: Date;
}

@Injectable()
export class RepositoryCollaboratorsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async upsertByRepoCollaborator(
    input: UpsertRepoCollaboratorInput,
    tx?: AppDatabase,
  ): Promise<void> {
    await this.exec(tx)
      .insertInto('github.repositoryCollaborators')
      .values({
        repositoryId: input.repositoryId,
        collaboratorId: input.collaboratorId,
        roleName: input.roleName,
        permissionAdmin: input.permissionAdmin,
        permissionMaintain: input.permissionMaintain,
        permissionPush: input.permissionPush,
        permissionTriage: input.permissionTriage,
        permissionPull: input.permissionPull,
        raw: JSON.stringify(input.raw),
      })
      .onConflict((oc) =>
        oc.columns(['repositoryId', 'collaboratorId']).doUpdateSet({
          roleName: input.roleName,
          permissionAdmin: input.permissionAdmin,
          permissionMaintain: input.permissionMaintain,
          permissionPush: input.permissionPush,
          permissionTriage: input.permissionTriage,
          permissionPull: input.permissionPull,
          raw: JSON.stringify(input.raw),
          deletedAt: null,
          updatedAt: new Date(),
        }),
      )
      .execute();
  }

  async softDeleteAllForRepo(
    repositoryId: string,
    tx?: AppDatabase,
  ): Promise<number> {
    const rows = await this.exec(tx)
      .updateTable('github.repositoryCollaborators')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('repositoryId', '=', repositoryId)
      .where('deletedAt', 'is', null)
      .returning(['id'])
      .execute();
    return rows.length;
  }

  async softDeleteMissingForRepo(
    repositoryId: string,
    liveCollaboratorIds: string[],
    tx?: AppDatabase,
  ): Promise<number> {
    let query = this.exec(tx)
      .updateTable('github.repositoryCollaborators')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('repositoryId', '=', repositoryId)
      .where('deletedAt', 'is', null);
    if (liveCollaboratorIds.length > 0) {
      query = query.where('collaboratorId', 'not in', liveCollaboratorIds);
    }
    const rows = await query.returning(['id']).execute();
    return rows.length;
  }

  async findActiveByRepoId(
    repositoryId: string,
    tx?: AppDatabase,
  ): Promise<ActiveRepoCollaboratorRow[]> {
    return this.exec(tx)
      .selectFrom('github.repositoryCollaborators as rc')
      .innerJoin('github.collaborators as c', 'c.id', 'rc.collaboratorId')
      .select([
        'rc.id as joinId',
        'c.id as collaboratorId',
        'c.githubUserId',
        'c.login',
        'c.avatarUrl',
        'c.htmlUrl',
        'c.type',
        'c.siteAdmin',
        'rc.roleName',
        'rc.permissionAdmin',
        'rc.permissionMaintain',
        'rc.permissionPush',
        'rc.permissionTriage',
        'rc.permissionPull',
        'rc.updatedAt',
      ])
      .where('rc.repositoryId', '=', repositoryId)
      .where('rc.deletedAt', 'is', null)
      .where('c.deletedAt', 'is', null)
      .orderBy('rc.roleName', 'desc')
      .orderBy('c.login', 'asc')
      .execute();
  }
}
