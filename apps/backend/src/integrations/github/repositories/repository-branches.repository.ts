import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../../databases/kysely';
import type { AppDatabase } from '../../../databases/kysely';

export type RepositoryBranchSetResult =
  | { locked: false; added: string }
  /** Already configured; nothing was written. `existing` is the frozen branch. */
  | { locked: true; existing: string };

@Injectable()
export class RepositoryBranchesRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async listByRepository(
    repositoryId: string,
    tx?: AppDatabase,
  ): Promise<string[]> {
    const rows = await this.exec(tx)
      .selectFrom('github.repositoryBranches')
      .select('branch')
      .where('repositoryId', '=', repositoryId)
      .where('deletedAt', 'is', null)
      .orderBy('branch')
      .execute();
    return rows.map((r) => r.branch);
  }

  /** Batched for list endpoints — one query instead of one per repository. */
  async listByRepositories(
    repositoryIds: string[],
    tx?: AppDatabase,
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (repositoryIds.length === 0) return out;

    const rows = await this.exec(tx)
      .selectFrom('github.repositoryBranches')
      .select(['repositoryId', 'branch'])
      .where('repositoryId', 'in', repositoryIds)
      .where('deletedAt', 'is', null)
      .orderBy('branch')
      .execute();

    for (const row of rows) {
      const list = out.get(row.repositoryId);
      if (list) list.push(row.branch);
      else out.set(row.repositoryId, [row.branch]);
    }
    return out;
  }

  /**
   * Set the branch a repository is read on, **once**. A repository that already
   * has one is frozen: no swapping, and no second branch — one repository reads
   * one branch.
   *
   * Deliberately restrictive for now. Changing it is not a config edit — it
   * re-reads history and spends OpenAI tokens, and because commits are keyed
   * `(repository_id, sha)` with attribution in `commit_branches`, the old
   * branch's commits stay behind and keep showing up in briefs. Until that story
   * is designed, the safe state is immutable, and loosening it later costs one
   * guard. `deleted_at` stays on the table (and in the partial unique index) so
   * untracking has somewhere to land when it is designed.
   *
   * The table can still hold several rows per repository — that is what a future
   * multi-branch mode would use — but nothing writes a second one today.
   *
   * Returns `locked` rather than throwing: HTTP semantics belong to the service.
   */
  async setBranchOnce(
    repositoryId: string,
    branch: string,
    tx?: AppDatabase,
  ): Promise<RepositoryBranchSetResult> {
    const run = async (
      exec: AppDatabase,
    ): Promise<RepositoryBranchSetResult> => {
      // Lock the repository row first: the check and the insert have to be
      // atomic, or two admins pressing Start at the same moment both read an
      // empty set and both insert — which is a changed selection, exactly what
      // write-once forbids. The unique index alone wouldn't catch it, since they
      // would be inserting *different* branches.
      await exec
        .selectFrom('github.repositories')
        .select('id')
        .where('id', '=', repositoryId)
        .forUpdate()
        .executeTakeFirst();

      const existing = await this.listByRepository(repositoryId, exec);
      if (existing.length > 0) {
        return { locked: true, existing: existing[0] };
      }

      await exec
        .insertInto('github.repositoryBranches')
        .values({ repositoryId, branch })
        .execute();

      return { locked: false, added: branch };
    };

    return tx ? run(tx) : this.db.transaction().execute(run);
  }

  /**
   * One page of every tracked (repository, branch) pair across **all**
   * organizations — the work list for the nightly sweep.
   *
   * Paged rather than returned whole because the caller is a workflow: the result
   * crosses a Temporal payload boundary and lands in replayable history, so the
   * position travels back as a cursor instead of the list growing with the
   * tenant count. Keyset on `(repositoryId, branch)`, not on `repositoryId`
   * alone: today one repository reads one branch, but the table is a set on
   * purpose, and a repository-only cursor would silently skip a second branch
   * whose row fell on the far side of a page boundary.
   *
   * `organizationId` comes back with each row because every child start must
   * carry it as a search attribute — without it the work is invisible in that
   * org's background-jobs toast.
   */
  async listTrackedPage(input: {
    limit: number;
    after?: { repositoryId: string; branch: string } | null;
    tx?: AppDatabase;
  }): Promise<
    Array<{ repositoryId: string; branch: string; organizationId: string }>
  > {
    let query = this.exec(input.tx)
      .selectFrom('github.repositoryBranches as rb')
      .innerJoin('github.repositories as r', 'r.id', 'rb.repositoryId')
      .innerJoin('github.installations as i', 'i.id', 'r.installationId')
      .select([
        'rb.repositoryId as repositoryId',
        'rb.branch as branch',
        'i.organizationId as organizationId',
      ])
      .where('rb.deletedAt', 'is', null)
      .where('r.deletedAt', 'is', null)
      .where('i.deletedAt', 'is', null);

    const after = input.after;
    if (after) {
      query = query.where((eb) =>
        eb.or([
          eb('rb.repositoryId', '>', after.repositoryId),
          eb.and([
            eb('rb.repositoryId', '=', after.repositoryId),
            eb('rb.branch', '>', after.branch),
          ]),
        ]),
      );
    }

    return query
      .orderBy('rb.repositoryId', 'asc')
      .orderBy('rb.branch', 'asc')
      .limit(input.limit)
      .execute();
  }
}
