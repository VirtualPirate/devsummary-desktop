import { Inject, Injectable, Logger } from '@nestjs/common';
import { chunk, KYSELY_DB } from '../../../databases/kysely';
import type {
  AppDatabase,
  GithubRepositorySelect,
} from '../../../databases/kysely';

export interface RepoReconcileRow {
  githubRepoId: bigint;
  name: string;
  fullName: string;
  private: boolean;
  raw: unknown;
}

@Injectable()
export class GithubRepositoriesRepository {
  private readonly logger = new Logger(GithubRepositoriesRepository.name);

  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async findById(
    id: string,
    tx?: AppDatabase,
  ): Promise<GithubRepositorySelect | null> {
    const row = await this.exec(tx)
      .selectFrom('github.repositories')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * Resolves a GitHub-side repo id to its row (used by the webhook receiver to
   * derive the owning org). The unique index is (installation_id,
   * github_repo_id), so the same GitHub repo can legitimately appear under more
   * than one installation row — an active one plus soft-deleted leftovers from
   * an org that disconnected. Prefer the single active row; when a GitHub repo
   * id somehow resolves to two *active* rows the owning org is genuinely
   * ambiguous, so refuse to guess rather than attribute commits to whichever
   * row the planner happened to return first.
   */
  async findByGithubRepoId(
    githubRepoId: bigint,
    opts: { includeDeleted?: boolean } = {},
    tx?: AppDatabase,
  ): Promise<GithubRepositorySelect | null> {
    let query = this.exec(tx)
      .selectFrom('github.repositories')
      .selectAll()
      .where('githubRepoId', '=', githubRepoId);
    if (!opts.includeDeleted) {
      query = query.where('deletedAt', 'is', null);
    }
    const rows = await query
      .orderBy('createdAt', 'asc')
      .orderBy('id')
      .execute();

    const active = rows.filter((r) => r.deletedAt === null);
    if (active.length > 1) {
      this.logger.error(
        `github repo id ${githubRepoId.toString()} matches ${active.length} active repository rows (${active
          .map((r) => r.id)
          .join(', ')}); refusing to attribute it to one`,
      );
      return null;
    }

    return active[0] ?? rows[0] ?? null;
  }

  async findByIdIncludingDeleted(
    id: string,
    tx?: AppDatabase,
  ): Promise<GithubRepositorySelect | null> {
    const row = await this.exec(tx)
      .selectFrom('github.repositories')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ?? null;
  }

  async findByIdScopedToOrg(
    id: string,
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<GithubRepositorySelect | null> {
    const row = await this.exec(tx)
      .selectFrom('github.repositories')
      .innerJoin(
        'github.installations',
        'github.installations.id',
        'github.repositories.installationId',
      )
      .select([
        'github.repositories.id',
        'github.repositories.installationId',
        'github.repositories.githubRepoId',
        'github.repositories.name',
        'github.repositories.fullName',
        'github.repositories.private',
        'github.repositories.raw',
        'github.repositories.createdAt',
        'github.repositories.updatedAt',
        'github.repositories.deletedAt',
      ])
      .where('github.repositories.id', '=', id)
      .where('github.installations.organizationId', '=', organizationId)
      .where('github.repositories.deletedAt', 'is', null)
      .where('github.installations.deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  async listByInstallation(
    installationId: string,
    tx?: AppDatabase,
  ): Promise<GithubRepositorySelect[]> {
    return this.exec(tx)
      .selectFrom('github.repositories')
      .selectAll()
      .where('installationId', '=', installationId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  /**
   * Reconcile the repo set for an installation against the latest GitHub
   * payload. Upserts each payload row on (installation_id, github_repo_id):
   * refreshes name/full_name/private/raw, clears deleted_at, bumps updated_at.
   * Soft-deletes (deleted_at = now()) any DB row not in the payload.
   *
   * Every statement runs on the supplied executor (tx or db), so a caller that
   * passes a transaction still gets the whole reconcile atomically. Without one
   * the upsert is several statements, so a crash can leave the payload half
   * applied — which repairs itself: the upsert is idempotent, the soft-delete
   * has not run yet, and both callers re-reconcile the full payload on the next
   * install or sync.
   */
  async reconcileForInstallation(
    installationId: string,
    rows: RepoReconcileRow[],
    tx?: AppDatabase,
  ): Promise<void> {
    const exec = this.exec(tx);
    const now = new Date();

    // 6 bound columns per row plus 2 in the conflict clause: one statement per
    // installation hit the bind-parameter cap at ~10.9k repositories.
    for (const batch of chunk(rows)) {
      await exec
        .insertInto('github.repositories')
        .values(
          batch.map((r) => ({
            installationId,
            githubRepoId: r.githubRepoId,
            name: r.name,
            fullName: r.fullName,
            private: r.private,
            raw: r.raw == null ? null : JSON.stringify(r.raw),
          })),
        )
        .onConflict((oc) =>
          oc.columns(['installationId', 'githubRepoId']).doUpdateSet({
            name: (eb) => eb.ref('excluded.name'),
            fullName: (eb) => eb.ref('excluded.fullName'),
            private: (eb) => eb.ref('excluded.private'),
            raw: (eb) => eb.ref('excluded.raw'),
            deletedAt: null,
            updatedAt: now,
          }),
        )
        .execute();
    }

    const keepIds = rows.map((r) => r.githubRepoId);
    let query = exec
      .updateTable('github.repositories')
      .set({ deletedAt: now, updatedAt: now })
      .where('installationId', '=', installationId)
      .where('deletedAt', 'is', null);
    if (keepIds.length > 0) {
      // Not chunked, and must not be: a `not in` over one batch soft-deletes
      // every row outside that batch. One parameter per id keeps this a single
      // statement up to ~65.5k repositories per installation; past that the keep
      // set has to be materialised, not split.
      query = query.where('githubRepoId', 'not in', keepIds);
    }
    await query.execute();
  }

  async softDeleteAllForInstallation(
    installationId: string,
    tx?: AppDatabase,
  ): Promise<void> {
    await this.exec(tx)
      .updateTable('github.repositories')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('installationId', '=', installationId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async listIdsByOrganization(
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<string[]> {
    const rows = await this.exec(tx)
      .selectFrom('github.repositories')
      .innerJoin(
        'github.installations',
        'github.installations.id',
        'github.repositories.installationId',
      )
      .select('github.repositories.id')
      .where('github.installations.organizationId', '=', organizationId)
      .where('github.repositories.deletedAt', 'is', null)
      .where('github.installations.deletedAt', 'is', null)
      .execute();
    return rows.map((r) => r.id);
  }
}
