import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../databases/kysely';
import type {
  AppDatabase,
  OrganizationInviteInsert,
  OrganizationInviteSelect,
  OrganizationSelect,
  UserSelect,
} from '../../databases/kysely';
import type { DbExecutor } from './organizations.repository';

type InviteStatus = OrganizationInviteSelect['status'];

export interface InviteWithRefs {
  invite: OrganizationInviteSelect;
  organization: OrganizationSelect;
  invitedBy: Pick<UserSelect, 'id' | 'name' | 'email'> | null;
}

interface InviteListRow {
  inviteId: string;
  inviteOrganizationId: string;
  inviteEmail: string;
  inviteRole: OrganizationInviteSelect['role'];
  inviteTokenHash: string;
  inviteStatus: InviteStatus;
  inviteExpiresAt: Date;
  inviteInvitedByUserId: string | null;
  inviteAcceptedByUserId: string | null;
  inviteAcceptedAt: Date | null;
  inviteCreatedAt: Date;
  inviteUpdatedAt: Date;
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgOwnerId: string;
  orgCreatedAt: Date;
  orgUpdatedAt: Date;
  invitedById: string | null;
  invitedByName: string | null;
  invitedByEmail: string | null;
}

@Injectable()
export class OrganizationInvitesRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.db;
  }

  private listQuery(tx?: DbExecutor) {
    return this.exec(tx)
      .selectFrom('organizationInvites')
      .innerJoin(
        'organizations',
        'organizations.id',
        'organizationInvites.organizationId',
      )
      .leftJoin(
        'auth.user as invitedBy',
        'invitedBy.id',
        'organizationInvites.invitedByUserId',
      )
      .select([
        'organizationInvites.id as inviteId',
        'organizationInvites.organizationId as inviteOrganizationId',
        'organizationInvites.email as inviteEmail',
        'organizationInvites.role as inviteRole',
        'organizationInvites.tokenHash as inviteTokenHash',
        'organizationInvites.status as inviteStatus',
        'organizationInvites.expiresAt as inviteExpiresAt',
        'organizationInvites.invitedByUserId as inviteInvitedByUserId',
        'organizationInvites.acceptedByUserId as inviteAcceptedByUserId',
        'organizationInvites.acceptedAt as inviteAcceptedAt',
        'organizationInvites.createdAt as inviteCreatedAt',
        'organizationInvites.updatedAt as inviteUpdatedAt',
        'organizations.id as orgId',
        'organizations.name as orgName',
        'organizations.slug as orgSlug',
        'organizations.ownerId as orgOwnerId',
        'organizations.createdAt as orgCreatedAt',
        'organizations.updatedAt as orgUpdatedAt',
        'invitedBy.id as invitedById',
        'invitedBy.name as invitedByName',
        'invitedBy.email as invitedByEmail',
      ])
      .orderBy('organizationInvites.createdAt', 'desc');
  }

  private toInviteWithRefs(r: InviteListRow): InviteWithRefs {
    return {
      invite: {
        id: r.inviteId,
        organizationId: r.inviteOrganizationId,
        email: r.inviteEmail,
        role: r.inviteRole,
        tokenHash: r.inviteTokenHash,
        status: r.inviteStatus,
        expiresAt: r.inviteExpiresAt,
        invitedByUserId: r.inviteInvitedByUserId,
        acceptedByUserId: r.inviteAcceptedByUserId,
        acceptedAt: r.inviteAcceptedAt,
        createdAt: r.inviteCreatedAt,
        updatedAt: r.inviteUpdatedAt,
      },
      organization: {
        id: r.orgId,
        name: r.orgName,
        slug: r.orgSlug,
        ownerId: r.orgOwnerId,
        createdAt: r.orgCreatedAt,
        updatedAt: r.orgUpdatedAt,
      },
      invitedBy: r.invitedById
        ? {
            id: r.invitedById,
            name: r.invitedByName!,
            email: r.invitedByEmail!,
          }
        : null,
    };
  }

  async findById(
    id: string,
    tx?: DbExecutor,
  ): Promise<OrganizationInviteSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('organizationInvites')
      .selectAll()
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async findByTokenHash(
    tokenHash: string,
    tx?: DbExecutor,
  ): Promise<OrganizationInviteSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('organizationInvites')
      .selectAll()
      .where('tokenHash', '=', tokenHash)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async findPendingByOrgAndEmail(
    organizationId: string,
    email: string,
    tx?: DbExecutor,
  ): Promise<OrganizationInviteSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('organizationInvites')
      .selectAll()
      .where('organizationId', '=', organizationId)
      .where('email', '=', email)
      .where('status', '=', 'pending')
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async listByOrg(
    organizationId: string,
    opts: { status?: InviteStatus | 'all' } = {},
    tx?: DbExecutor,
  ): Promise<InviteWithRefs[]> {
    let query = this.listQuery(tx).where(
      'organizationInvites.organizationId',
      '=',
      organizationId,
    );
    if (opts.status && opts.status !== 'all') {
      query = query.where('organizationInvites.status', '=', opts.status);
    }
    const rows = await query.execute();
    return rows.map((r) => this.toInviteWithRefs(r));
  }

  async listByEmail(
    email: string,
    opts: { status?: InviteStatus | 'all'; notExpiredAfter?: Date } = {},
    tx?: DbExecutor,
  ): Promise<InviteWithRefs[]> {
    let query = this.listQuery(tx).where(
      'organizationInvites.email',
      '=',
      email,
    );
    if (opts.status && opts.status !== 'all') {
      query = query.where('organizationInvites.status', '=', opts.status);
    }
    if (opts.notExpiredAfter) {
      query = query.where(
        'organizationInvites.expiresAt',
        '>',
        opts.notExpiredAfter,
      );
    }
    const rows = await query.execute();
    return rows.map((r) => this.toInviteWithRefs(r));
  }

  async create(
    input: OrganizationInviteInsert,
    tx?: DbExecutor,
  ): Promise<OrganizationInviteSelect> {
    const row = await this.exec(tx)
      .insertInto('organizationInvites')
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
    return row;
  }

  async updateStatus(
    id: string,
    status: InviteStatus,
    tx?: DbExecutor,
  ): Promise<OrganizationInviteSelect | null> {
    const row = await this.exec(tx)
      .updateTable('organizationInvites')
      .set({ status, updatedAt: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  async rotateToken(
    id: string,
    patch: { tokenHash: string; expiresAt: Date },
    tx?: DbExecutor,
  ): Promise<OrganizationInviteSelect | null> {
    const row = await this.exec(tx)
      .updateTable('organizationInvites')
      .set({
        tokenHash: patch.tokenHash,
        expiresAt: patch.expiresAt,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  async markAccepted(
    id: string,
    acceptedByUserId: string,
    acceptedAt: Date,
    tx?: DbExecutor,
  ): Promise<OrganizationInviteSelect | null> {
    const row = await this.exec(tx)
      .updateTable('organizationInvites')
      .set({
        status: 'accepted',
        acceptedByUserId,
        acceptedAt,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }
}
