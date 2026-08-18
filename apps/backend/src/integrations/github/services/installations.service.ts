import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  GithubInstallation,
  GithubInstallationWithRepos,
  GithubRepository,
} from '@launchstack/api-interfaces';
import { AppError } from '../../../common/errors';
import { KYSELY_DB } from '../../../databases/kysely';
import type {
  AppDatabase,
  GithubInstallationSelect,
  GithubRepositorySelect,
} from '../../../databases/kysely';
import {
  TemporalProducerService,
  WORKFLOW,
  buildSearchAttributes,
} from '../../../temporal';
import type { GithubAppConfig } from '../github-app.config';
import type { GithubAppClient } from '../github-app.client';
import { GithubInstallationsRepository } from '../repositories/installations.repository';
import { GithubRepositoriesRepository } from '../repositories/repositories.repository';
import { RepositoryBranchesRepository } from '../repositories/repository-branches.repository';
import { StateTokenService } from './state-token.service';

function serializeInstallation(
  row: GithubInstallationSelect,
): GithubInstallation {
  return {
    id: row.id,
    githubInstallationId: row.githubInstallationId.toString(),
    accountLogin: row.githubAccountLogin,
    accountType: row.githubAccountType,
    accountAvatarUrl: row.githubAccountAvatarUrl,
    suspendedAt: row.suspendedAt ? row.suspendedAt.toISOString() : null,
    connectedByUserId: row.connectedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeRepo(
  row: GithubRepositorySelect,
  branches: string[],
): GithubRepository {
  return {
    id: row.id,
    githubRepoId: row.githubRepoId.toString(),
    name: row.name,
    fullName: row.fullName,
    private: row.private,
    // One repository reads one branch; the table holds the set only so a future
    // multi-branch mode has somewhere to grow.
    branch: branches[0] ?? null,
  };
}

@Injectable()
export class GithubInstallationsService {
  private readonly logger = new Logger(GithubInstallationsService.name);

  constructor(
    private readonly installs: GithubInstallationsRepository,
    private readonly repos: GithubRepositoriesRepository,
    private readonly trackedBranches: RepositoryBranchesRepository,
    private readonly stateToken: StateTokenService,
    private readonly client: GithubAppClient,
    private readonly config: GithubAppConfig | null,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
    private readonly temporal: TemporalProducerService,
  ) {}

  private requireConfig(): GithubAppConfig {
    if (!this.config) {
      throw AppError.GITHUB_APP_NOT_CONFIGURED();
    }
    return this.config;
  }

  /**
   * The invariant the install callback rests on: the installation row we are
   * about to write through must belong to the org we resolved from the state
   * token. GitHub issues one installation id per (app, account), so a lookup by
   * that id can hand back a **different tenant's** row — writing through it
   * would reconcile that org's repos, resurrect its soft-deleted installation,
   * and tag Temporal workflows with the wrong `organizationId`.
   *
   * Only ever called with a live row. A soft-deleted row means that org
   * disconnected and has no claim on the installation id.
   *
   * **Deliberately does not uninstall the App on GitHub.** The 409 leaves the
   * App installed on the GitHub account, which looks like an orphan from the
   * caller's org — but the installation belongs to the org named in the log line
   * below, and GitHub issues one installation per (app, account), so uninstalling
   * would silently break *that* org's ingestion. The user's own org gets no row,
   * so nothing here is orphaned from DevSummary's side either.
   */
  private assertInstallationBelongsToOrg(
    installation: Pick<
      GithubInstallationSelect,
      'organizationId' | 'githubInstallationId'
    >,
    orgId: string,
  ): void {
    if (installation.organizationId !== orgId) {
      // The error can't name the owning org (cross-tenant leak), so log it —
      // otherwise support has no way to tell the user where to disconnect.
      this.logger.warn(
        `github installation ${installation.githubInstallationId} is connected to org ${installation.organizationId}; rejecting connect from org ${orgId} (App left installed on the GitHub account)`,
      );
      throw AppError.GITHUB_INSTALLATION_ALREADY_CONNECTED();
    }
  }

  buildInstallUrl(input: { orgId: string; userId: string }): string {
    const config = this.requireConfig();
    const state = this.stateToken.sign(input);
    return `https://github.com/apps/${config.slug}/installations/new?state=${state}`;
  }

  async handleCallback(input: {
    state: string | undefined;
    installationId: bigint;
    setupAction: 'install' | 'update';
    sessionUserId: string | null;
  }): Promise<{ orgId: string }> {
    this.requireConfig();

    const active = await this.installs.findActiveByGithubInstallationId(
      input.installationId,
    );

    let orgId: string;
    let connectedByUserId: string | null;

    if (input.state) {
      let payload: { orgId: string; userId: string };
      try {
        payload = this.stateToken.verify(input.state);
      } catch {
        throw AppError.GITHUB_STATE_INVALID();
      }
      if (input.sessionUserId && payload.userId !== input.sessionUserId) {
        throw AppError.GITHUB_STATE_USER_MISMATCH();
      }
      orgId = payload.orgId;
      connectedByUserId = payload.userId;
    } else {
      // Stateless callback — GitHub "Configure" flow from app settings.
      // Only valid for an already-known live installation we're re-syncing.
      if (input.setupAction !== 'update' || !active) {
        throw AppError.GITHUB_STATE_INVALID();
      }
      orgId = active.organizationId;
      connectedByUserId = null;
    }

    // Reject before touching anything: the GitHub account may already be
    // connected to a different DevSummary org. (The stateless "Configure" path
    // above derives `orgId` from the row itself, so it can never mismatch.)
    if (active) {
      this.assertInstallationBelongsToOrg(active, orgId);
    }

    // No live row: this org may still have a soft-deleted one to revive from an
    // earlier connect/disconnect cycle. Scoped to `orgId`, so a *different*
    // org's disconnected row is ignored and we insert a fresh row instead —
    // which the partial unique index permits.
    const existing =
      active ??
      (await this.installs.findRevivableByGithubInstallationId(
        input.installationId,
        orgId,
      ));

    const repos = await this.client.listInstallationRepos(input.installationId);
    const repoRows = repos.map((repo) => ({
      githubRepoId: BigInt(repo.githubRepoId),
      name: repo.name,
      fullName: repo.fullName,
      private: repo.private,
      raw: repo.raw,
    }));

    const beforeIds: string[] = existing
      ? (await this.repos.listByInstallation(existing.id)).map((r) => r.id)
      : [];

    const installationRowId = await this.db
      .transaction()
      .execute(async (tx) => {
        // One variable for the row we write through, so its org and `orgId`
        // cannot drift apart the way `rowId` + `orgId` could.
        let row = existing;

        if (!row) {
          const meta = await this.client.getInstallation(input.installationId);
          row = await this.installs.create(
            {
              organizationId: orgId,
              githubInstallationId: BigInt(meta.githubInstallationId),
              githubAccountId: BigInt(meta.githubAccountId),
              githubAccountLogin: meta.accountLogin,
              githubAccountType: meta.accountType,
              githubAccountAvatarUrl: meta.accountAvatarUrl,
              targetType: meta.targetType,
              suspendedAt: meta.suspendedAt,
              connectedByUserId,
              raw: meta.raw,
            },
            tx,
          );
        } else if (row.deletedAt) {
          // Same-org re-install: revive our own row so its repositories (and
          // their commits) come back rather than being re-ingested from scratch.
          await this.installs.undelete(row.id, tx);
        }

        // Already guaranteed above (rejected for an existing row, `orgId` by
        // construction for a fresh one) — re-checked so a future edit that
        // decouples the two fails loudly instead of reconciling another org's
        // repos and mis-tagging its workflows.
        this.assertInstallationBelongsToOrg(row, orgId);

        await this.repos.reconcileForInstallation(row.id, repoRows, tx);
        return row.id;
      });

    const afterIds = (
      await this.repos.listByInstallation(installationRowId)
    ).map((r) => r.id);
    const beforeSet = new Set(beforeIds);
    const afterSet = new Set(afterIds);
    const connected = afterIds.filter((id) => !beforeSet.has(id));
    const disconnected = beforeIds.filter((id) => !afterSet.has(id));

    // Collaborators only. Commit ingestion is **not** started here: a newly
    // connected repository has no branch yet (`branch IS NULL`), and picking one
    // is what starts `ScanRepositoryWorkflow` — see
    // `RepositoryBranchesService.setBranches`. Starting a scan here is what used
    // to read a branch the user never chose and spend OpenAI tokens without
    // consent.
    for (const repositoryId of connected) {
      await this.temporal.start(WORKFLOW.syncRepoCollaborators, {
        args: [{ repositoryId, trigger: 'connected', organizationId: orgId }],
        searchAttributes: buildSearchAttributes({
          organizationId: orgId,
          phase: 'fetching',
        }),
      });
    }
    for (const repositoryId of disconnected) {
      await this.temporal.start(WORKFLOW.syncRepoCollaborators, {
        args: [
          { repositoryId, trigger: 'disconnected', organizationId: orgId },
        ],
        searchAttributes: buildSearchAttributes({
          organizationId: orgId,
          phase: 'fetching',
        }),
      });
    }

    return { orgId };
  }

  async listForOrg(orgId: string): Promise<GithubInstallationWithRepos[]> {
    const installations = await this.installs.listByOrganization(orgId);
    const out: GithubInstallationWithRepos[] = [];

    for (const installation of installations) {
      const repos = await this.repos.listByInstallation(installation.id);
      const branchesByRepo = await this.trackedBranches.listByRepositories(
        repos.map((r) => r.id),
      );
      out.push({
        ...serializeInstallation(installation),
        repositories: repos.map((repo) =>
          serializeRepo(repo, branchesByRepo.get(repo.id) ?? []),
        ),
      });
    }

    return out;
  }

  async sync(
    orgId: string,
    installationRowId: string,
  ): Promise<GithubInstallationWithRepos> {
    this.requireConfig();

    const installation = await this.installs.findByIdScopedToOrg(
      installationRowId,
      orgId,
    );
    if (!installation) {
      throw AppError.GITHUB_INSTALLATION_NOT_FOUND();
    }

    const beforeIds = (
      await this.repos.listByInstallation(installation.id)
    ).map((r) => r.id);

    const repos = await this.client.listInstallationRepos(
      installation.githubInstallationId,
    );

    await this.repos.reconcileForInstallation(
      installation.id,
      repos.map((repo) => ({
        githubRepoId: BigInt(repo.githubRepoId),
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private,
        raw: repo.raw,
      })),
    );

    const updatedRepos = await this.repos.listByInstallation(installation.id);
    const afterIds = updatedRepos.map((r) => r.id);
    const beforeSet = new Set(beforeIds);
    const afterSet = new Set(afterIds);
    const connected = afterIds.filter((id) => !beforeSet.has(id));
    const disconnected = beforeIds.filter((id) => !afterSet.has(id));

    // Same as the install callback: no commit ingestion from here. `sync` runs
    // with no user present (it also backs GitHub's own "Configure" flow), so a
    // repo it adds stays branch-less and inert until somebody chooses a branch.
    for (const repositoryId of connected) {
      await this.temporal.start(WORKFLOW.syncRepoCollaborators, {
        args: [{ repositoryId, trigger: 'connected', organizationId: orgId }],
        searchAttributes: buildSearchAttributes({
          organizationId: orgId,
          phase: 'fetching',
        }),
      });
    }
    for (const repositoryId of disconnected) {
      await this.temporal.start(WORKFLOW.syncRepoCollaborators, {
        args: [
          { repositoryId, trigger: 'disconnected', organizationId: orgId },
        ],
        searchAttributes: buildSearchAttributes({
          organizationId: orgId,
          phase: 'fetching',
        }),
      });
    }

    const branchesByRepo = await this.trackedBranches.listByRepositories(
      updatedRepos.map((r) => r.id),
    );
    return {
      ...serializeInstallation(installation),
      repositories: updatedRepos.map((repo) =>
        serializeRepo(repo, branchesByRepo.get(repo.id) ?? []),
      ),
    };
  }

  async disconnect(orgId: string, installationRowId: string): Promise<void> {
    const installation = await this.installs.findByIdScopedToOrg(
      installationRowId,
      orgId,
    );
    if (!installation) {
      throw AppError.GITHUB_INSTALLATION_NOT_FOUND();
    }

    const reposToDisconnect = await this.repos.listByInstallation(
      installation.id,
    );

    try {
      await this.client.deleteInstallation(installation.githubInstallationId);
    } catch {
      // GitHub side may already be gone (suspended / manually removed);
      // we still soft-delete locally.
    }

    await this.db.transaction().execute(async (tx) => {
      await this.repos.softDeleteAllForInstallation(installation.id, tx);
      await this.installs.softDelete(installation.id, tx);
    });

    for (const repo of reposToDisconnect) {
      await this.temporal.start(WORKFLOW.syncRepoCollaborators, {
        args: [
          {
            repositoryId: repo.id,
            trigger: 'disconnected',
            organizationId: orgId,
          },
        ],
        searchAttributes: buildSearchAttributes({
          organizationId: orgId,
          phase: 'fetching',
        }),
      });
    }
  }
}
