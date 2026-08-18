import { Injectable } from '@nestjs/common';
import { CollaboratorsRepository } from '../../../integrations/github/collaborators/repositories/collaborators.repository';
import { GithubRepositoriesRepository } from '../../../integrations/github/repositories/repositories.repository';
import { ProjectsRepository } from '../../projects/repositories/projects.repository';
import { ProjectRepositoriesRepository } from '../../projects/repositories/project-repositories.repository';
import { TeamsRepository } from '../../teams/repositories/teams.repository';
import { TeamCollaboratorsRepository } from '../../teams/repositories/team-collaborators.repository';

export type BriefScope =
  | { type: 'project'; projectId: string }
  | { type: 'team'; teamId: string }
  | { type: 'collaborator'; collaboratorId: string }
  | { type: 'repository'; repositoryId: string; branch?: string };

export interface ResolvedScope {
  repositoryIds: string[];
  scopeLabel: string;
  /**
   * `undefined` means "no author restriction". `[]` means the scope selects no
   * authors at all (e.g. a team with no members) and must therefore match no
   * commits — collapsing the two widens such a scope to every author.
   */
  authorFilter?: bigint[];
  /**
   * `undefined` means every branch the repositories are tracked on. Only a
   * repository scope can narrow it — a project or team scope spans repositories
   * whose branch names have nothing to do with each other.
   */
  branchFilter?: string;
}

@Injectable()
export class BriefScopeResolver {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly projectLinks: ProjectRepositoriesRepository,
    private readonly teams: TeamsRepository,
    private readonly teamLinks: TeamCollaboratorsRepository,
    private readonly collaborators: CollaboratorsRepository,
    private readonly repos: GithubRepositoriesRepository,
  ) {}

  async resolve(input: {
    organizationId: string;
    scope: BriefScope;
  }): Promise<ResolvedScope> {
    const { organizationId, scope } = input;
    if (scope.type === 'project') {
      const project = await this.projects.findByIdScopedToOrg(
        scope.projectId,
        organizationId,
      );
      if (!project) throw new Error('SCOPE_DELETED: project missing');
      const links = await this.projectLinks.listByProject(project.id);
      // Junction rows are only validated when they are written, so re-check them
      // against the org's live repositories: soft-deleted repos and repos under a
      // disconnected installation must drop out of the scope.
      const liveRepositoryIds = new Set(
        await this.repos.listIdsByOrganization(organizationId),
      );
      return {
        repositoryIds: links
          .map((l) => l.repositoryId)
          .filter((id) => liveRepositoryIds.has(id)),
        scopeLabel: `Project: ${project.name}`,
      };
    }
    if (scope.type === 'team') {
      const team = await this.teams.findByIdScopedToOrg(
        scope.teamId,
        organizationId,
      );
      if (!team) throw new Error('SCOPE_DELETED: team missing');
      const memberLinks = await this.teamLinks.listByTeam(team.id);
      const collabRows = await Promise.all(
        memberLinks.map((l) => this.collaborators.findById(l.collaboratorId)),
      );
      const authorFilter = collabRows
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => c.githubUserId);
      // A team with no resolvable members selects nobody, so it must select no
      // repositories either: the author filter is the only thing narrowing an
      // org-wide repository list, and an empty one has to fail closed.
      if (authorFilter.length === 0) {
        return {
          repositoryIds: [],
          scopeLabel: `Team: ${team.name}`,
          authorFilter,
        };
      }
      const repositoryIds =
        await this.repos.listIdsByOrganization(organizationId);
      return { repositoryIds, scopeLabel: `Team: ${team.name}`, authorFilter };
    }
    if (scope.type === 'collaborator') {
      const collab = await this.collaborators.findByIdScopedToOrg(
        scope.collaboratorId,
        organizationId,
      );
      if (!collab) throw new Error('SCOPE_DELETED: collaborator missing');
      const repositoryIds =
        await this.repos.listIdsByOrganization(organizationId);
      return {
        repositoryIds,
        scopeLabel: `Collaborator: ${collab.login}`,
        authorFilter: [collab.githubUserId],
      };
    }
    const repo = await this.repos.findByIdScopedToOrg(
      scope.repositoryId,
      organizationId,
    );
    if (!repo) throw new Error('SCOPE_DELETED: repository missing');
    return {
      repositoryIds: [repo.id],
      scopeLabel: scope.branch
        ? `Repository: ${repo.fullName} (${scope.branch})`
        : `Repository: ${repo.fullName}`,
      branchFilter: scope.branch,
    };
  }
}
