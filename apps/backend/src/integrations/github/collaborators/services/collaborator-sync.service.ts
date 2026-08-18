import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../../../common/errors';
import { KYSELY_DB, type AppDatabase } from '../../../../databases/kysely';
import { GithubAppClient } from '../../github.client';
import { GithubInstallationsRepository } from '../../repositories/installations.repository';
import { GithubRepositoriesRepository } from '../../repositories/repositories.repository';
import { CollaboratorsRepository } from '../repositories/collaborators.repository';
import { RepositoryCollaboratorsRepository } from '../repositories/repository-collaborators.repository';

export type SyncTrigger = 'connected' | 'disconnected' | 'manual';

@Injectable()
export class CollaboratorSyncService {
  private readonly logger = new Logger(CollaboratorSyncService.name);

  constructor(
    private readonly collaborators: CollaboratorsRepository,
    private readonly repoCollabs: RepositoryCollaboratorsRepository,
    private readonly repos: GithubRepositoriesRepository,
    private readonly installs: GithubInstallationsRepository,
    private readonly client: GithubAppClient,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
  ) {}

  async syncRepo(repositoryId: string, trigger: SyncTrigger): Promise<void> {
    const repo = await this.repos.findByIdIncludingDeleted(repositoryId);
    if (!repo) {
      this.logger.warn(
        `repo not found (trigger=${trigger}) id=${repositoryId}`,
      );
      return;
    }

    if (trigger === 'disconnected' || repo.deletedAt) {
      const removed = await this.repoCollabs.softDeleteAllForRepo(repositoryId);
      this.logger.log(
        `soft-deleted join rows repo=${repositoryId} trigger=${trigger} removed=${removed}`,
      );
      return;
    }

    const installation = await this.installs.findByIdIncludingDeleted(
      repo.installationId,
    );
    if (!installation || installation.deletedAt) {
      this.logger.warn(
        `installation gone, treating as disconnected repo=${repositoryId}`,
      );
      await this.repoCollabs.softDeleteAllForRepo(repositoryId);
      return;
    }

    const [owner, repoName] = repo.fullName.split('/');
    let liveCollabs;
    try {
      liveCollabs = await this.client.listRepoCollaborators(
        installation.githubInstallationId,
        owner,
        repoName,
      );
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        this.logger.warn(
          `collaborators 404 repo=${repositoryId}, treating as disconnected`,
        );
        await this.repoCollabs.softDeleteAllForRepo(repositoryId);
        return;
      }
      if (status === 403) {
        throw AppError.GITHUB_API_FAILED({ reason: 'collaborators_forbidden' });
      }
      throw AppError.GITHUB_API_FAILED({
        reason:
          err instanceof Error ? err.message : 'list_collaborators_failed',
      });
    }

    await this.db.transaction().execute(async (tx) => {
      const liveCollaboratorIds: string[] = [];
      for (const c of liveCollabs) {
        const collaborator = await this.collaborators.upsertByGithubUserId(
          {
            githubUserId: BigInt(c.id),
            login: c.login,
            nodeId: c.node_id ?? null,
            avatarUrl: c.avatar_url ?? null,
            htmlUrl: c.html_url ?? null,
            type: c.type ?? null,
            siteAdmin: c.site_admin ?? false,
            raw: c,
          },
          tx,
        );
        await this.repoCollabs.upsertByRepoCollaborator(
          {
            repositoryId,
            collaboratorId: collaborator.id,
            roleName: c.role_name,
            permissionAdmin: c.permissions.admin,
            permissionMaintain: c.permissions.maintain,
            permissionPush: c.permissions.push,
            permissionTriage: c.permissions.triage,
            permissionPull: c.permissions.pull,
            raw: c,
          },
          tx,
        );
        liveCollaboratorIds.push(collaborator.id);
      }
      const removed = await this.repoCollabs.softDeleteMissingForRepo(
        repositoryId,
        liveCollaboratorIds,
        tx,
      );
      this.logger.log(
        `synced collaborators repo=${repositoryId} trigger=${trigger} upserted=${liveCollaboratorIds.length} removed=${removed}`,
      );
    });
  }
}
