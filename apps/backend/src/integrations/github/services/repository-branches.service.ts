import { Injectable, Logger } from '@nestjs/common';
import type {
  ListRepositoryBranchesResponse,
  SetRepositoryBranchesResponse,
} from '@launchstack/api-interfaces';
import { AppError } from '../../../common/errors';
import { JOB, JobQueueService } from '../../../jobs';
// Value import, not `import type`: the class is the DI token, and a type-only
// import erases it so Nest sees an unresolvable dependency at boot. (The
// module binds this token to a stub that rejects when the App isn't configured.)
import { GithubAppClient } from '../github.client';
import { GithubInstallationsRepository } from '../repositories/installations.repository';
import { GithubRepositoriesRepository } from '../repositories/repositories.repository';
import { RepositoryBranchesRepository } from '../repositories/repository-branches.repository';
import type { SetRepositoryBranchesBody } from '../dto/repositories.dto';

@Injectable()
export class RepositoryBranchesService {
  private readonly logger = new Logger(RepositoryBranchesService.name);

  constructor(
    private readonly repos: GithubRepositoriesRepository,
    private readonly installs: GithubInstallationsRepository,
    private readonly client: GithubAppClient,
    private readonly queue: JobQueueService,
    private readonly trackedBranches: RepositoryBranchesRepository,
  ) {}

  async listBranches(
    organizationId: string,
    repositoryId: string,
  ): Promise<ListRepositoryBranchesResponse> {
    const repo = await this.repos.findByIdScopedToOrg(
      repositoryId,
      organizationId,
    );
    if (!repo) throw AppError.GITHUB_REPOSITORY_NOT_FOUND();

    const installation = await this.installs.findById(repo.installationId);
    if (!installation) throw AppError.GITHUB_INSTALLATION_NOT_FOUND();

    const list = await this.client.listBranches(
      installation.githubInstallationId,
      repo.fullName,
    );

    return {
      branches: list.branches.map((branch) => ({
        name: branch.name,
        isDefault: branch.isDefault,
        lastCommitAt: branch.lastCommitAt
          ? branch.lastCommitAt.toISOString()
          : null,
      })),
      defaultBranch: list.defaultBranch,
      truncated: list.truncated,
    };
  }

  /**
   * Choosing a branch is what starts ingestion — connecting the GitHub App no
   * longer does. Each selection sets that repository's branch **once**, then one
   * `ScanRepositoryWorkflow` (fetch + analyze) starts for it with the requested
   * history window.
   *
   * Ownership *and* the lock are checked for every selection **before** anything
   * is written, so neither a bad id nor an already-configured repository can
   * leave half the batch written. Beyond that the loop is deliberately not
   * transactional: the write and the workflow start cannot be made atomic
   * anyway, and the dedup key makes a retried request cheap (a repository already
   * scanning rejoins its run instead of double-fetching).
   *
   * A locked repository is a 409, not a silent skip — the only way to hit it is a
   * stale page or a second admin, and both deserve to be told.
   */
  async setBranches(
    organizationId: string,
    body: SetRepositoryBranchesBody,
  ): Promise<SetRepositoryBranchesResponse> {
    const seen = new Set<string>();
    for (const selection of body.selections) {
      if (seen.has(selection.repositoryId)) {
        throw AppError.BAD_REQUEST({
          message: `Repository ${selection.repositoryId} appears twice in selections`,
        });
      }
      seen.add(selection.repositoryId);

      const repo = await this.repos.findByIdScopedToOrg(
        selection.repositoryId,
        organizationId,
      );
      if (!repo) throw AppError.GITHUB_REPOSITORY_NOT_FOUND();

      const existing = await this.trackedBranches.listByRepository(repo.id);
      if (existing.length > 0) {
        throw AppError.GITHUB_REPOSITORY_BRANCHES_LOCKED({
          fullName: repo.fullName,
          branches: existing,
        });
      }
    }

    const jobIds: string[] = [];
    for (const selection of body.selections) {
      const result = await this.trackedBranches.setBranchOnce(
        selection.repositoryId,
        selection.branch,
      );
      // Re-checked at the write, not just in the loop above: two concurrent
      // requests both pass the pre-flight, and the second must not overwrite a
      // branch the first just froze.
      if (result.locked) {
        throw AppError.GITHUB_REPOSITORY_BRANCHES_LOCKED({
          fullName: selection.repositoryId,
          branches: [result.existing],
        });
      }

      const jobId = await this.queue.enqueue(
        JOB.scanRepository,
        {
          repositoryId: selection.repositoryId,
          branch: result.added,
          lookbackDays: body.lookbackDays,
          organizationId,
        },
        {
          id: `scan:${selection.repositoryId}:${result.added}`,
          phase: 'fetching',
          organizationId,
        },
      );
      jobIds.push(jobId);

      this.logger.log(
        `repository ${selection.repositoryId} now reads ${result.added} (${body.lookbackDays}d lookback), permanent`,
      );
    }

    return { jobIds, started: jobIds.length };
  }
}
