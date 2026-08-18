import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  KYSELY_DB,
  type AppDatabase,
  type BriefScheduleInsert,
  type BriefScheduleSelect,
} from '../../../databases/kysely';

@Injectable()
export class BriefSchedulesRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async listByOrganization(
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<BriefScheduleSelect[]> {
    return this.exec(tx)
      .selectFrom('briefs.briefSchedules')
      .selectAll()
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  async findByIdScopedToOrg(
    id: string,
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<BriefScheduleSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('briefs.briefSchedules')
      .selectAll()
      .where('id', '=', id)
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  async findById(
    id: string,
    tx?: AppDatabase,
  ): Promise<BriefScheduleSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('briefs.briefSchedules')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  async create(
    input: BriefScheduleInsert,
    tx?: AppDatabase,
  ): Promise<BriefScheduleSelect> {
    return this.exec(tx)
      .insertInto('briefs.briefSchedules')
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    patch: Partial<BriefScheduleInsert>,
    tx?: AppDatabase,
  ): Promise<BriefScheduleSelect | null> {
    const row = await this.exec(tx)
      .updateTable('briefs.briefSchedules')
      .set({ ...patch, updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  async softDelete(id: string, tx?: AppDatabase): Promise<void> {
    await this.exec(tx)
      .updateTable('briefs.briefSchedules')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async countActiveByOrganization(
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<number> {
    const row = await this.exec(tx)
      .selectFrom('briefs.briefSchedules')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    return row.count;
  }

  /**
   * Drops Slack delivery from every live schedule pointing at an installation
   * (used when that installation is disconnected). Both columns must be nulled
   * in the same statement: the `brief_schedules_slack_pair` check constraint
   * requires both set or both null.
   */
  async clearSlackConfigForInstallation(
    slackInstallationId: string,
    tx?: AppDatabase,
  ): Promise<void> {
    await this.exec(tx)
      .updateTable('briefs.briefSchedules')
      .set({
        slackInstallationId: null,
        slackChannelId: null,
        updatedAt: new Date(),
      })
      .where('slackInstallationId', '=', slackInstallationId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  /**
   * Phase 1 of the dispatch claim: which schedules are due right now. Runs
   * outside a transaction, so the row locks it takes live only for the
   * statement — they exist purely to skip rows another dispatcher is already
   * claiming. Each id is re-locked and re-checked in phase 2.
   */
  async findDueIds(limit: number): Promise<string[]> {
    const rows = await this.findDueForUpdate(limit, this.db);
    return rows.map((r) => r.id);
  }

  /**
   * Phase 2 of the dispatch claim: re-lock one due schedule inside the caller's
   * transaction. Returns null when it is no longer due (another dispatcher
   * claimed it, or it was paused/deleted between the two phases).
   */
  async findDueByIdForUpdate(
    id: string,
    tx: AppDatabase,
  ): Promise<BriefScheduleSelect | null> {
    const [row] = await this.findDueForUpdate(1, tx, id);
    return row ?? null;
  }

  /**
   * Increments the dispatch failure counter and pauses the schedule once it
   * reaches `pauseAt`, so a permanently failing schedule stops occupying a slot
   * in the `next_run_at ASC` dispatch window (and shows up as paused in the UI).
   * Must run outside the failed claim transaction — that one has rolled back.
   */
  async recordDispatchFailure(
    id: string,
    reason: string,
    pauseAt: number,
    tx?: AppDatabase,
  ): Promise<BriefScheduleSelect | null> {
    const row = await this.exec(tx)
      .updateTable('briefs.briefSchedules')
      .set({
        dispatchFailureCount: sql<number>`dispatch_failure_count + 1`,
        dispatchFailureReason: reason,
        // OR, not a plain comparison: never un-pause a manually paused schedule.
        paused: sql<boolean>`paused OR (dispatch_failure_count + 1 >= ${pauseAt})`,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  /**
   * Selects due schedules and locks the rows for the duration of the transaction.
   * Caller MUST be inside a transaction (uses FOR UPDATE SKIP LOCKED), except via
   * `findDueIds` — see the note there.
   */
  async findDueForUpdate(
    limit: number,
    tx: AppDatabase,
    id?: string,
  ): Promise<BriefScheduleSelect[]> {
    // Must go through the query builder (not a raw `sql` statement): the
    // CamelCasePlugin maps columns to the camelCase field names the rest of
    // the code reads, whereas raw rows are keyed by snake_case DB column
    // names. `.forUpdate().skipLocked()` preserves the FOR UPDATE SKIP LOCKED
    // semantics.
    let query = tx
      .selectFrom('briefs.briefSchedules')
      .selectAll()
      .where('deletedAt', 'is', null)
      .where('paused', '=', false)
      .where('nextRunAt', '<=', sql<Date>`now()`);
    if (id) query = query.where('id', '=', id);
    return query
      .orderBy('nextRunAt', 'asc')
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
  }
}
