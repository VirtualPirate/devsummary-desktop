import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateProjectRequest,
  Project,
  SetProjectRepositoriesRequest,
  UpdateProjectRequest,
} from '@launchstack/api-interfaces';
import { AppError } from '../../../common/errors';
import { KYSELY_DB, type AppDatabase } from '../../../databases/kysely';
import { GithubRepositoriesRepository } from '../../../integrations/github/repositories/repositories.repository';
import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectRepositoriesRepository } from '../repositories/project-repositories.repository';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly links: ProjectRepositoriesRepository,
    private readonly repos: GithubRepositoriesRepository,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
  ) {}

  async list(organizationId: string): Promise<Project[]> {
    const rows = await this.projects.listByOrganization(organizationId);
    const linksByProject = await this.links.listRepositoryIdsForProjects(
      rows.map((r) => r.id),
    );
    return rows.map((r) => this.toResponse(r, linksByProject.get(r.id) ?? []));
  }

  async get(organizationId: string, projectId: string): Promise<Project> {
    const row = await this.projects.findByIdScopedToOrg(
      projectId,
      organizationId,
    );
    if (!row) throw AppError.PROJECT_NOT_FOUND();
    const repoLinks = await this.links.listByProject(projectId);
    return this.toResponse(
      row,
      repoLinks.map((l) => l.repositoryId),
    );
  }

  async create(
    organizationId: string,
    _createdByMemberId: string,
    body: CreateProjectRequest,
  ): Promise<Project> {
    await this.assertRepositoriesInOrg(organizationId, body.repositoryIds);
    const existing = await this.projects.findByNameInOrg(
      organizationId,
      body.name,
    );
    if (existing) throw AppError.PROJECT_NAME_CONFLICT();

    return this.db.transaction().execute(async (trx) => {
      const row = await this.projects.create(
        {
          organizationId,
          name: body.name,
          description: body.description ?? null,
          color: body.color ?? null,
        },
        trx,
      );
      await this.links.replaceForProject(row.id, body.repositoryIds, trx);
      return this.toResponse(row, body.repositoryIds);
    });
  }

  async update(
    organizationId: string,
    projectId: string,
    body: UpdateProjectRequest,
  ): Promise<Project> {
    const row = await this.projects.findByIdScopedToOrg(
      projectId,
      organizationId,
    );
    if (!row) throw AppError.PROJECT_NOT_FOUND();
    if (body.name && body.name !== row.name) {
      const collision = await this.projects.findByNameInOrg(
        organizationId,
        body.name,
      );
      if (collision && collision.id !== row.id) {
        throw AppError.PROJECT_NAME_CONFLICT();
      }
    }
    const updated = await this.projects.update(projectId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
    });
    if (!updated) throw AppError.PROJECT_NOT_FOUND();
    const repoLinks = await this.links.listByProject(projectId);
    return this.toResponse(
      updated,
      repoLinks.map((l) => l.repositoryId),
    );
  }

  async setRepositories(
    organizationId: string,
    projectId: string,
    body: SetProjectRepositoriesRequest,
  ): Promise<Project> {
    const row = await this.projects.findByIdScopedToOrg(
      projectId,
      organizationId,
    );
    if (!row) throw AppError.PROJECT_NOT_FOUND();
    await this.assertRepositoriesInOrg(organizationId, body.repositoryIds);
    await this.db
      .transaction()
      .execute((trx) =>
        this.links.replaceForProject(projectId, body.repositoryIds, trx),
      );
    return this.toResponse(row, body.repositoryIds);
  }

  async delete(organizationId: string, projectId: string): Promise<void> {
    const row = await this.projects.findByIdScopedToOrg(
      projectId,
      organizationId,
    );
    if (!row) throw AppError.PROJECT_NOT_FOUND();
    await this.projects.softDelete(projectId);
  }

  private async assertRepositoriesInOrg(
    organizationId: string,
    repositoryIds: string[],
  ): Promise<void> {
    for (const id of repositoryIds) {
      const repo = await this.repos.findByIdScopedToOrg(id, organizationId);
      if (!repo) throw AppError.GITHUB_REPOSITORY_NOT_FOUND();
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
    repositoryIds: string[],
  ): Project {
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      description: row.description,
      color: row.color,
      repositoryIds,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
