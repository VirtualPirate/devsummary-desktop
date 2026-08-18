import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateTeamRequest,
  SetTeamCollaboratorsRequest,
  Team,
  UpdateTeamRequest,
} from '@launchstack/api-interfaces';
import { AppError } from '../../../common/errors';
import { KYSELY_DB, type AppDatabase } from '../../../databases/kysely';
import { CollaboratorsRepository } from '../../../integrations/github/collaborators/repositories/collaborators.repository';
import { TeamsRepository } from '../repositories/teams.repository';
import { TeamCollaboratorsRepository } from '../repositories/team-collaborators.repository';

@Injectable()
export class TeamsService {
  constructor(
    private readonly teams: TeamsRepository,
    private readonly links: TeamCollaboratorsRepository,
    private readonly collaborators: CollaboratorsRepository,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
  ) {}

  async list(organizationId: string): Promise<Team[]> {
    const rows = await this.teams.listByOrganization(organizationId);
    const linksByTeam = await this.links.listCollaboratorIdsForTeams(
      rows.map((r) => r.id),
    );
    return rows.map((r) => this.toResponse(r, linksByTeam.get(r.id) ?? []));
  }

  async get(organizationId: string, teamId: string): Promise<Team> {
    const row = await this.teams.findByIdScopedToOrg(teamId, organizationId);
    if (!row) throw AppError.TEAM_NOT_FOUND();
    const collabLinks = await this.links.listByTeam(teamId);
    return this.toResponse(
      row,
      collabLinks.map((l) => l.collaboratorId),
    );
  }

  async create(
    organizationId: string,
    _createdByMemberId: string,
    body: CreateTeamRequest,
  ): Promise<Team> {
    await this.assertCollaboratorsInOrg(organizationId, body.collaboratorIds);
    const existing = await this.teams.findByNameInOrg(
      organizationId,
      body.name,
    );
    if (existing) throw AppError.TEAM_NAME_CONFLICT();

    return this.db.transaction().execute(async (trx) => {
      const row = await this.teams.create(
        {
          organizationId,
          name: body.name,
          description: body.description ?? null,
          color: body.color ?? null,
        },
        trx,
      );
      await this.links.replaceForTeam(row.id, body.collaboratorIds, trx);
      return this.toResponse(row, body.collaboratorIds);
    });
  }

  async update(
    organizationId: string,
    teamId: string,
    body: UpdateTeamRequest,
  ): Promise<Team> {
    const row = await this.teams.findByIdScopedToOrg(teamId, organizationId);
    if (!row) throw AppError.TEAM_NOT_FOUND();
    if (body.name && body.name !== row.name) {
      const collision = await this.teams.findByNameInOrg(
        organizationId,
        body.name,
      );
      if (collision && collision.id !== row.id) {
        throw AppError.TEAM_NAME_CONFLICT();
      }
    }
    const updated = await this.teams.update(teamId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
    });
    if (!updated) throw AppError.TEAM_NOT_FOUND();
    const collabLinks = await this.links.listByTeam(teamId);
    return this.toResponse(
      updated,
      collabLinks.map((l) => l.collaboratorId),
    );
  }

  async setCollaborators(
    organizationId: string,
    teamId: string,
    body: SetTeamCollaboratorsRequest,
  ): Promise<Team> {
    const row = await this.teams.findByIdScopedToOrg(teamId, organizationId);
    if (!row) throw AppError.TEAM_NOT_FOUND();
    await this.assertCollaboratorsInOrg(organizationId, body.collaboratorIds);
    await this.db
      .transaction()
      .execute((trx) =>
        this.links.replaceForTeam(teamId, body.collaboratorIds, trx),
      );
    return this.toResponse(row, body.collaboratorIds);
  }

  async delete(organizationId: string, teamId: string): Promise<void> {
    const row = await this.teams.findByIdScopedToOrg(teamId, organizationId);
    if (!row) throw AppError.TEAM_NOT_FOUND();
    await this.teams.softDelete(teamId);
  }

  private async assertCollaboratorsInOrg(
    organizationId: string,
    collaboratorIds: string[],
  ): Promise<void> {
    for (const id of collaboratorIds) {
      const found = await this.collaborators.findByIdScopedToOrg(
        id,
        organizationId,
      );
      if (!found) throw AppError.GITHUB_COLLABORATOR_NOT_FOUND();
    }
  }

  private toResponse(
    row: {
      id: string;
      organizationId: string;
      name: string;
      description: string | null;
      color: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    collaboratorIds: string[],
  ): Team {
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      description: row.description,
      color: row.color,
      collaboratorIds,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
