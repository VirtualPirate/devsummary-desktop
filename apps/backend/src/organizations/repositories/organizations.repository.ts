import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../databases/kysely';
import type {
  AppDatabase,
  OrganizationInsert,
  OrganizationSelect,
} from '../../databases/kysely';

export type DbExecutor = AppDatabase;

@Injectable()
export class OrganizationsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.db;
  }

  async findById(
    id: string,
    tx?: DbExecutor,
  ): Promise<OrganizationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('organizations')
      .selectAll()
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async findBySlug(
    slug: string,
    tx?: DbExecutor,
  ): Promise<OrganizationSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('organizations')
      .selectAll()
      .where('slug', '=', slug)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async create(
    input: OrganizationInsert,
    tx?: DbExecutor,
  ): Promise<OrganizationSelect> {
    const row = await this.exec(tx)
      .insertInto('organizations')
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
    return row;
  }

  async update(
    id: string,
    patch: Partial<Pick<OrganizationSelect, 'name' | 'slug'>>,
    tx?: DbExecutor,
  ): Promise<OrganizationSelect | null> {
    const row = await this.exec(tx)
      .updateTable('organizations')
      .set({ ...patch, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  /** Returns the number of rows deleted, so a no-op delete can 404. */
  async delete(id: string, tx?: DbExecutor): Promise<number> {
    const res = await this.exec(tx)
      .deleteFrom('organizations')
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(res.numDeletedRows ?? 0n);
  }

  /**
   * Takes a row lock so concurrent ownership transfers serialize *before* they
   * read memberships — otherwise both read the old roles under READ COMMITTED
   * and each promotes its own target, leaving the org with two owner rows.
   * Transaction-only by signature: outside one the lock is released at once.
   */
  async lockById(
    id: string,
    tx: DbExecutor,
  ): Promise<OrganizationSelect | null> {
    const row = await tx
      .selectFrom('organizations')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    return row ?? null;
  }

  async setOwner(
    id: string,
    newOwnerId: string,
    tx?: DbExecutor,
  ): Promise<OrganizationSelect | null> {
    const row = await this.exec(tx)
      .updateTable('organizations')
      .set({ ownerId: newOwnerId, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }
}
