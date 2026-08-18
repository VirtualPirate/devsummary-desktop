import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../../databases/kysely';
import type {
  AppDatabase,
  TeamCollaboratorSelect,
} from '../../../databases/kysely';

@Injectable()
export class TeamCollaboratorsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async listByTeam(
    teamId: string,
    tx?: AppDatabase,
  ): Promise<TeamCollaboratorSelect[]> {
    return this.exec(tx)
      .selectFrom('briefs.teamCollaborators')
      .selectAll()
      .where('teamId', '=', teamId)
      .execute();
  }

  async listCollaboratorIdsForTeams(
    teamIds: string[],
    tx?: AppDatabase,
  ): Promise<Map<string, string[]>> {
    if (teamIds.length === 0) return new Map();
    const rows = await this.exec(tx)
      .selectFrom('briefs.teamCollaborators')
      .select(['teamId', 'collaboratorId'])
      .where('teamId', 'in', teamIds)
      .execute();
    const map = new Map<string, string[]>();
    for (const id of teamIds) map.set(id, []);
    for (const r of rows) map.get(r.teamId)?.push(r.collaboratorId);
    return map;
  }

  async replaceForTeam(
    teamId: string,
    collaboratorIds: string[],
    tx?: AppDatabase,
  ): Promise<void> {
    const executor = this.exec(tx);
    await executor
      .deleteFrom('briefs.teamCollaborators')
      .where('teamId', '=', teamId)
      .execute();
    if (collaboratorIds.length === 0) return;
    await executor
      .insertInto('briefs.teamCollaborators')
      .values(
        collaboratorIds.map((collaboratorId) => ({ teamId, collaboratorId })),
      )
      .execute();
  }
}
