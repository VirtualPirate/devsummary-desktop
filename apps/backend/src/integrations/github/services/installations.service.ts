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
import { JOB, JobQueueService } from '../../../jobs';
import { SecretsService } from '../../../local/settings/secrets.service';
import { sealGithubToken } from '../credentials';
import { GithubAppClient } from '../github.client';
import { GithubInstallationsRepository } from '../repositories/installations.repository';
import { GithubRepositoriesRepository } from '../repositories/repositories.repository';
import { RepositoryBranchesRepository } from '../repositories/repository-branches.repository';

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

/** The id a probe client is called with — it resolves to the pasted token. */
const PROBE_ID = 0n;

@Injectable()
export class GithubInstallationsService {
  private readonly logger = new Logger(GithubInstallationsService.name);

  constructor(
    private readonly installs: GithubInstallationsRepository,
    private readonly repos: GithubRepositoriesRepository,
    private readonly trackedBranches: RepositoryBranchesRepository,
    private readonly client: GithubAppClient,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
    private readonly queue: JobQueueService,
    private readonly secrets: SecretsService,
  ) {}

  /**
   * The invariant connecting rests on: the installation row we are about to
   * write through must belong to the org we are connecting. GitHub issues one
   * account id per PAT owner, so a lookup by that id can hand back a **different
   * workspace's** row — writing through it would reconcile that workspace's
   * repos and tag its jobs with the wrong `organizationId`.
   */
  private assertInstallationBelongsToOrg(
    installation: Pick<
      GithubInstallationSelect,
      'organizationId' | 'githubInstallationId'
    >,
    orgId: string,
  ): void {
    if (installation.organizationId !== orgId) {
      // The error can't name the owning workspace, so log it — otherwise there
      // is no way to tell the user where to disconnect.
      this.logger.warn(
        `github account ${installation.githubInstallationId} is connected to org ${installation.organizationId}; rejecting connect from org ${orgId}`,
      );
      throw AppError.GITHUB_INSTALLATION_ALREADY_CONNECTED();
    }
  }

  /**
   * Validate a pasted fine-grained PAT and store it encrypted, then reconcile
   * the repositories it can see. Replaces the App install callback: there is no
   * public callback URL on a desktop machine, so the credential is pasted.
   *
   * **No commit ingestion starts here** — a freshly connected repository has no
   * branch (`branch IS NULL`) and stays inert until the branch-setup screen
   * chooses one. Only collaborator sync fans out, exactly as the callback did.
   */
  async connect(input: {
    orgId: string;
    token: string;
    connectedByUserId?: string | null;
  }): Promise<GithubInstallationWithRepos> {
    const { orgId } = input;
    const token = input.token.trim();
    // A throwaway client bound to the candidate token: validation has to happen
    // before anything is stored, and the injected client only knows stored ones.
    const probe = new GithubAppClient(() => Promise.resolve(token));

    const meta = await probe
      .getInstallation(PROBE_ID)
      .catch((err: unknown) => this.rejectToken(err, 'GET /user'));
    const repos = await probe
      .listInstallationRepos(PROBE_ID)
      .catch((err: unknown) => this.rejectToken(err, 'GET /user/repos'));

    const githubAccountId = BigInt(meta.githubInstallationId);
    const active =
      await this.installs.findActiveByGithubInstallationId(githubAccountId);
    if (active) {
      this.assertInstallationBelongsToOrg(active, orgId);
    }

    // No live row: this workspace may still have a soft-deleted one to revive
    // from an earlier connect/disconnect cycle, which brings its repositories
    // (and their commits) back instead of re-ingesting from scratch.
    const existing =
      active ??
      (await this.installs.findRevivableByGithubInstallationId(
        githubAccountId,
        orgId,
      ));

    const credential = {
      githubAccountLogin: meta.accountLogin,
      githubAccountType: meta.accountType,
      githubAccountAvatarUrl: meta.accountAvatarUrl,
      targetType: meta.targetType,
      suspendedAt: meta.suspendedAt,
      raw: sealGithubToken(token, meta.raw, this.secrets.encryptionKey()),
    };

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

    // A token that authenticates but grants nothing is refused only when there
    // is nothing stored to correct, and "stored" means **live repository rows**,
    // not an installation row — a disconnected workspace keeps a revivable
    // installation, so testing `existing` here would accept a useless token for
    // any account that had ever connected.
    //
    // When there *are* live rows the paste must go through and reconcile them
    // away. They came from a wider token, or from before grants were checked at
    // all, and the picker reads those rows rather than GitHub — so refusing
    // would leave the user staring at exactly the repositories they just told us
    // the token cannot reach. The clear is recoverable: rows are soft-deleted,
    // and re-pasting a working token undeletes them with their commits intact.
    if (repos.length === 0) {
      if (beforeIds.length === 0) {
        throw AppError.GITHUB_TOKEN_GRANTS_NO_REPOS({ visible: 0 });
      }
      this.logger.warn(
        `token for github account ${meta.accountLogin} grants no repositories; clearing ${beforeIds.length} stored`,
      );
    }

    const installationRowId = await this.db
      .transaction()
      .execute(async (tx) => {
        // One variable for the row we write through, so its org and `orgId`
        // cannot drift apart.
        let row = existing;

        if (!row) {
          row = await this.installs.create(
            {
              organizationId: orgId,
              githubInstallationId: githubAccountId,
              githubAccountId,
              connectedByUserId: input.connectedByUserId ?? null,
              ...credential,
            },
            tx,
          );
        } else {
          if (row.deletedAt) await this.installs.undelete(row.id, tx);
          // Re-pasting a rotated token updates the row in place — deleting and
          // recreating it would orphan every repository and commit under it.
          await this.installs.updateCredential(row.id, credential, tx);
        }

        // Already guaranteed above (rejected for an existing row, `orgId` by
        // construction for a fresh one) — re-checked so a future edit that
        // decouples the two fails loudly instead of reconciling another
        // workspace's repos.
        this.assertInstallationBelongsToOrg(row, orgId);

        await this.repos.reconcileForInstallation(row.id, repoRows, tx);
        return row.id;
      });

    // Same write Slack's `connectToken` makes: the bundle is what the Electron
    // shell persists to the keychain, so the token survives a wiped data
    // directory and `GET /api/local-settings` has one source for `github`.
    this.secrets.update({ GITHUB_TOKEN: token });

    await this.syncCollaboratorsForDiff(orgId, installationRowId, beforeIds);

    const installation = await this.installs.findById(installationRowId);
    if (!installation) throw AppError.GITHUB_INSTALLATION_NOT_FOUND();
    return this.withRepos(installation);
  }

  /**
   * A rejected credential is the user's problem to fix, not a bad gateway — the
   * message names the endpoint so "token has no repo access" is separable from
   * "token is invalid".
   */
  private rejectToken(err: unknown, endpoint: string): never {
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.warn(`github token rejected at ${endpoint}: ${reason}`);
    throw AppError.BAD_REQUEST({
      message: `GitHub rejected this token (${endpoint}). Check it has not expired and grants Contents: Read-only and Metadata: Read-only on the repositories you want.`,
    });
  }

  async listForOrg(orgId: string): Promise<GithubInstallationWithRepos[]> {
    const installations = await this.installs.listByOrganization(orgId);
    const out: GithubInstallationWithRepos[] = [];

    for (const installation of installations) {
      out.push(await this.withRepos(installation));
    }

    return out;
  }

  async sync(
    orgId: string,
    installationRowId: string,
  ): Promise<GithubInstallationWithRepos> {
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

    // Sync is the button a user presses *because* the list looks wrong, so it
    // reconciles to nothing when the token grants nothing — refusing would make
    // the one control that can clear stale rows the one that cannot. The wipe is
    // soft and reversible, and a rate-limited probe never lands here:
    // `listInstallationRepos` fails open to the unfiltered list instead of
    // reporting an empty grant set.
    if (repos.length === 0 && beforeIds.length > 0) {
      this.logger.warn(
        `sync found no granted repositories for installation ${installation.id}; soft-deleting ${beforeIds.length}`,
      );
    }

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

    // Same as connect: no commit ingestion from here. A repo `sync` adds stays
    // branch-less and inert until somebody chooses a branch.
    await this.syncCollaboratorsForDiff(orgId, installation.id, beforeIds);

    return this.withRepos(installation);
  }

  /** Drops the stored credential and everything under it. */
  async disconnect(orgId: string): Promise<void> {
    const installations = await this.installs.listByOrganization(orgId);
    if (installations.length === 0) {
      throw AppError.GITHUB_INSTALLATION_NOT_FOUND();
    }

    for (const installation of installations) {
      const reposToDisconnect = await this.repos.listByInstallation(
        installation.id,
      );

      await this.db.transaction().execute(async (tx) => {
        await this.repos.softDeleteAllForInstallation(installation.id, tx);
        await this.installs.softDelete(installation.id, tx);
      });

      for (const repo of reposToDisconnect) {
        await this.startCollaboratorSync(orgId, repo.id, 'disconnected');
      }
    }

    this.secrets.update({ GITHUB_TOKEN: undefined });
  }

  private async withRepos(
    installation: GithubInstallationSelect,
  ): Promise<GithubInstallationWithRepos> {
    const repos = await this.repos.listByInstallation(installation.id);
    const branchesByRepo = await this.trackedBranches.listByRepositories(
      repos.map((r) => r.id),
    );
    return {
      ...serializeInstallation(installation),
      repositories: repos.map((repo) =>
        serializeRepo(repo, branchesByRepo.get(repo.id) ?? []),
      ),
    };
  }

  /** Collaborators only — never commit ingestion. See `connect`. */
  private async syncCollaboratorsForDiff(
    orgId: string,
    installationRowId: string,
    beforeIds: string[],
  ): Promise<void> {
    const afterIds = (
      await this.repos.listByInstallation(installationRowId)
    ).map((r) => r.id);
    const beforeSet = new Set(beforeIds);
    const afterSet = new Set(afterIds);

    for (const repositoryId of afterIds.filter((id) => !beforeSet.has(id))) {
      await this.startCollaboratorSync(orgId, repositoryId, 'connected');
    }
    for (const repositoryId of beforeIds.filter((id) => !afterSet.has(id))) {
      await this.startCollaboratorSync(orgId, repositoryId, 'disconnected');
    }
  }

  private async startCollaboratorSync(
    organizationId: string,
    repositoryId: string,
    trigger: 'connected' | 'disconnected',
  ): Promise<void> {
    await this.queue.enqueue(
      JOB.syncRepoCollaborators,
      { repositoryId, trigger, organizationId },
      { phase: 'fetching', organizationId },
    );
  }
}
