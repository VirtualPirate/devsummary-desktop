import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../../databases/kysely';
import type {
  AppDatabase,
  GithubInstallationInsert,
  GithubInstallationSelect,
} from '../../../databases/kysely';

export type GithubInstallationCreateInput = Omit<
  GithubInstallationInsert,
  'raw'
> & {
  raw?: unknown;
};

@Injectable()
export class GithubInstallationsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async findById(
    id: string,
    tx?: AppDatabase,
  ): Promise<GithubInstallationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('github.installations')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * The live installation for a GitHub-side installation id, if any. At most one
   * can exist — `installations_github_installation_id_active_unique` is unique on
   * `github_installation_id WHERE deleted_at IS NULL`. Soft-deleted rows are
   * excluded on purpose: an org that disconnected has no claim on the id, so
   * another org may take it over.
   */
  async findActiveByGithubInstallationId(
    githubInstallationId: bigint,
    tx?: AppDatabase,
  ): Promise<GithubInstallationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('github.installations')
      .selectAll()
      .where('githubInstallationId', '=', githubInstallationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * A soft-deleted installation this org can revive, so re-connecting the same
   * GitHub account to the same org reuses its row (and its repositories) instead
   * of piling up a new one. Scoped to the org because another org's disconnected
   * row must never be resurrected. Newest first — the partial unique index only
   * constrains live rows, so an org that connected and disconnected repeatedly
   * can have several.
   */
  async findRevivableByGithubInstallationId(
    githubInstallationId: bigint,
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<GithubInstallationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('github.installations')
      .selectAll()
      .where('githubInstallationId', '=', githubInstallationId)
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is not', null)
      .orderBy('deletedAt', 'desc')
      .executeTakeFirst();
    return row ?? null;
  }

  async findByIdIncludingDeleted(
    id: string,
    tx?: AppDatabase,
  ): Promise<GithubInstallationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('github.installations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ?? null;
  }

  async findByIdScopedToOrg(
    id: string,
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<GithubInstallationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('github.installations')
      .selectAll()
      .where('id', '=', id)
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  async listByOrganization(
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<GithubInstallationSelect[]> {
    return this.exec(tx)
      .selectFrom('github.installations')
      .selectAll()
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async create(
    input: GithubInstallationCreateInput,
    tx?: AppDatabase,
  ): Promise<GithubInstallationSelect> {
    const { raw, ...rest } = input;
    return this.exec(tx)
      .insertInto('github.installations')
      .values({
        ...rest,
        raw: raw == null ? null : JSON.stringify(raw),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async softDelete(id: string, tx?: AppDatabase): Promise<void> {
    await this.exec(tx)
      .updateTable('github.installations')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async undelete(id: string, tx?: AppDatabase): Promise<void> {
    await this.exec(tx)
      .updateTable('github.installations')
      .set({ deletedAt: null, updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
