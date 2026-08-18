import { Inject, Injectable } from '@nestjs/common';
import {
  KYSELY_DB,
  type AppDatabase,
  type BriefInsert,
  type BriefSelect,
} from '../../../databases/kysely';

export interface ListBriefsFilters {
  organizationId: string;
  scheduleId?: string;
  scopeType?: 'project' | 'team' | 'collaborator' | 'repository';
  scopeProjectId?: string;
  scopeTeamId?: string;
  scopeCollaboratorId?: string;
  scopeRepositoryId?: string;
  /**
   * Both bounds are compared against the **stored exclusive** `period_end`, and
   * both arrive as exclusive local midnights (the frontend sends `to` as the
   * midnight *after* the picked day). See `list` for why `from` is strict.
   */
  periodEndFrom?: Date;
  periodEndTo?: Date;
  excludeNoActivity?: boolean;
  limit: number;
  cursorPeriodEnd?: Date;
  cursorId?: string;
}

@Injectable()
export class BriefsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  async findById(id: string, tx?: AppDatabase): Promise<BriefSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('briefs.briefs')
      .selectAll()
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  async findByIdScopedToOrg(
    id: string,
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<BriefSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('briefs.briefs')
      .selectAll()
      .where('id', '=', id)
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return row ?? null;
  }

  async create(input: BriefInsert, tx?: AppDatabase): Promise<BriefSelect> {
    return this.exec(tx)
      .insertInto('briefs.briefs')
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    patch: Partial<BriefInsert>,
    tx?: AppDatabase,
  ): Promise<BriefSelect | null> {
    const row = await this.exec(tx)
      .updateTable('briefs.briefs')
      .set({ ...patch, updatedAt: new Date() })
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  async softDelete(id: string, tx?: AppDatabase): Promise<void> {
    await this.exec(tx)
      .updateTable('briefs.briefs')
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async list(
    filters: ListBriefsFilters,
    tx?: AppDatabase,
  ): Promise<BriefSelect[]> {
    let query = this.exec(tx)
      .selectFrom('briefs.briefs')
      .selectAll()
      .where('organizationId', '=', filters.organizationId)
      .where('deletedAt', 'is', null);
    if (filters.scheduleId)
      query = query.where('briefScheduleId', '=', filters.scheduleId);
    if (filters.scopeType)
      query = query.where('scopeType', '=', filters.scopeType);
    if (filters.scopeProjectId)
      query = query.where('scopeProjectId', '=', filters.scopeProjectId);
    if (filters.scopeTeamId)
      query = query.where('scopeTeamId', '=', filters.scopeTeamId);
    if (filters.scopeCollaboratorId)
      query = query.where(
        'scopeCollaboratorId',
        '=',
        filters.scopeCollaboratorId,
      );
    if (filters.scopeRepositoryId)
      query = query.where('scopeRepositoryId', '=', filters.scopeRepositoryId);
    // Strict `>`: `period_end` is exclusive, so the brief covering the day
    // BEFORE `from` ends at exactly `from`. `>=` would pull it into a filter it
    // has no business being in ("from Aug 14" listing the Aug 13 brief).
    if (filters.periodEndFrom)
      query = query.where('periodEnd', '>', filters.periodEndFrom);
    // `<=` stays: `to` is itself an exclusive midnight, so a brief ending
    // exactly there is the last one the user asked for.
    if (filters.periodEndTo)
      query = query.where('periodEnd', '<=', filters.periodEndTo);
    if (filters.excludeNoActivity)
      query = query.where((eb) =>
        eb.not(
          eb.and([
            eb('commitCount', '=', 0),
            eb('status', 'in', ['generated', 'delivered']),
          ]),
        ),
      );
    if (filters.cursorPeriodEnd && filters.cursorId) {
      const { cursorPeriodEnd, cursorId } = filters;
      query = query.where((eb) =>
        eb.or([
          eb('periodEnd', '<', cursorPeriodEnd),
          eb.and([
            eb('periodEnd', '=', cursorPeriodEnd),
            eb('id', '<', cursorId),
          ]),
        ]),
      );
    }
    return query
      .orderBy('periodEnd', 'desc')
      .orderBy('id', 'desc')
      .limit(filters.limit)
      .execute();
  }

  /**
   * Briefs left `pending` long enough that whoever was supposed to generate
   * them is gone (worker death / activity timeout after the claim committed).
   * Nothing else re-drives them — `next_run_at` was already advanced — so the
   * dispatcher re-offers them; `markGenerating` makes a double dispatch a no-op.
   */
  async findStalePending(
    olderThan: Date,
    limit: number,
    tx?: AppDatabase,
  ): Promise<Array<{ id: string; organizationId: string }>> {
    return this.exec(tx)
      .selectFrom('briefs.briefs')
      .select(['id', 'organizationId'])
      .where('status', '=', 'pending')
      .where('createdAt', '<', olderThan)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .limit(limit)
      .execute();
  }

  /**
   * The latest brief for exactly this scope since `createdAfter`, so the
   * generate dialog can warn about a double-spend before it happens.
   *
   * Matched on scope + recency, never on the period: every preset recomputes
   * `now`, so two "last 7 days" requests a minute apart never share a
   * `period_end` and an equality match would warn about nothing. Failed briefs
   * are excluded — regenerating one of those is the point, not a mistake.
   */
  async findMostRecentForScope(
    input: {
      organizationId: string;
      scopeType: 'project' | 'team' | 'collaborator' | 'repository';
      scopeProjectId?: string | null;
      scopeTeamId?: string | null;
      scopeCollaboratorId?: string | null;
      scopeRepositoryId?: string | null;
      createdAfter: Date;
    },
    tx?: AppDatabase,
  ): Promise<BriefSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('briefs.briefs')
      .selectAll()
      .where('organizationId', '=', input.organizationId)
      .where('scopeType', '=', input.scopeType)
      .where(
        'scopeProjectId',
        input.scopeProjectId ? '=' : 'is',
        input.scopeProjectId ?? null,
      )
      .where(
        'scopeTeamId',
        input.scopeTeamId ? '=' : 'is',
        input.scopeTeamId ?? null,
      )
      .where(
        'scopeCollaboratorId',
        input.scopeCollaboratorId ? '=' : 'is',
        input.scopeCollaboratorId ?? null,
      )
      .where(
        'scopeRepositoryId',
        input.scopeRepositoryId ? '=' : 'is',
        input.scopeRepositoryId ?? null,
      )
      .where('createdAt', '>=', input.createdAfter)
      .where('status', '!=', 'failed')
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async findPeriodStartsForSchedule(
    scheduleId: string,
    since: Date,
    tx?: AppDatabase,
  ): Promise<Set<number>> {
    const rows = await this.exec(tx)
      .selectFrom('briefs.briefs')
      .select('periodStart')
      .where('briefScheduleId', '=', scheduleId)
      .where('periodStart', '>=', since)
      .where('deletedAt', 'is', null)
      .execute();
    return new Set(rows.map((r) => r.periodStart.getTime()));
  }
}
