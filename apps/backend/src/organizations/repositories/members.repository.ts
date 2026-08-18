import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../databases/kysely';
import type {
  AppDatabase,
  OrganizationMemberInsert,
  OrganizationMemberSelect,
  OrganizationSelect,
  UserSelect,
} from '../../databases/kysely';
import type { DbExecutor } from './organizations.repository';

export interface MemberRowWithUser {
  member: OrganizationMemberSelect;
  user: Pick<UserSelect, 'id' | 'name' | 'email' | 'image'>;
}

export interface MyOrganizationRow {
  organization: OrganizationSelect;
  member: OrganizationMemberSelect;
}

@Injectable()
export class OrganizationMembersRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.db;
  }

  async findByOrgAndUser(
    organizationId: string,
    userId: string,
    tx?: DbExecutor,
  ): Promise<OrganizationMemberSelect | null> {
    const row = await this.exec(tx)
      .selectFrom('organizationMembers')
      .selectAll()
      .where('organizationId', '=', organizationId)
      .where('userId', '=', userId)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  }

  async listByOrg(
    organizationId: string,
    tx?: DbExecutor,
  ): Promise<MemberRowWithUser[]> {
    const rows = await this.exec(tx)
      .selectFrom('organizationMembers')
      .innerJoin('auth.user as u', 'u.id', 'organizationMembers.userId')
      .select([
        'organizationMembers.id as memberId',
        'organizationMembers.organizationId as memberOrganizationId',
        'organizationMembers.userId as memberUserId',
        'organizationMembers.role as memberRole',
        'organizationMembers.createdAt as memberCreatedAt',
        'u.id as userId',
        'u.name as userName',
        'u.email as userEmail',
        'u.image as userImage',
      ])
      .where('organizationMembers.organizationId', '=', organizationId)
      .execute();
    return rows.map((r) => ({
      member: {
        id: r.memberId,
        organizationId: r.memberOrganizationId,
        userId: r.memberUserId,
        role: r.memberRole,
        createdAt: r.memberCreatedAt,
      },
      user: {
        id: r.userId,
        name: r.userName,
        email: r.userEmail,
        image: r.userImage,
      },
    }));
  }

  async listByUser(
    userId: string,
    tx?: DbExecutor,
  ): Promise<MyOrganizationRow[]> {
    const rows = await this.exec(tx)
      .selectFrom('organizationMembers')
      .innerJoin(
        'organizations',
        'organizations.id',
        'organizationMembers.organizationId',
      )
      .select([
        'organizations.id as orgId',
        'organizations.name as orgName',
        'organizations.slug as orgSlug',
        'organizations.ownerId as orgOwnerId',
        'organizations.createdAt as orgCreatedAt',
        'organizations.updatedAt as orgUpdatedAt',
        'organizationMembers.id as memberId',
        'organizationMembers.organizationId as memberOrganizationId',
        'organizationMembers.userId as memberUserId',
        'organizationMembers.role as memberRole',
        'organizationMembers.createdAt as memberCreatedAt',
      ])
      .where('organizationMembers.userId', '=', userId)
      .execute();
    return rows.map((r) => ({
      organization: {
        id: r.orgId,
        name: r.orgName,
        slug: r.orgSlug,
        ownerId: r.orgOwnerId,
        createdAt: r.orgCreatedAt,
        updatedAt: r.orgUpdatedAt,
      },
      member: {
        id: r.memberId,
        organizationId: r.memberOrganizationId,
        userId: r.memberUserId,
        role: r.memberRole,
        createdAt: r.memberCreatedAt,
      },
    }));
  }

  async create(
    input: OrganizationMemberInsert,
    tx?: DbExecutor,
  ): Promise<OrganizationMemberSelect> {
    const row = await this.exec(tx)
      .insertInto('organizationMembers')
      .values(input)
      .returningAll()
      .executeTakeFirstOrThrow();
    return row;
  }

  async updateRole(
    id: string,
    role: OrganizationMemberInsert['role'],
    tx?: DbExecutor,
  ): Promise<OrganizationMemberSelect | null> {
    const row = await this.exec(tx)
      .updateTable('organizationMembers')
      .set({ role })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return row ?? null;
  }

  async delete(id: string, tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .deleteFrom('organizationMembers')
      .where('id', '=', id)
      .execute();
  }

  async deleteByOrgAndUser(
    organizationId: string,
    userId: string,
    tx?: DbExecutor,
  ): Promise<void> {
    await this.exec(tx)
      .deleteFrom('organizationMembers')
      .where('organizationId', '=', organizationId)
      .where('userId', '=', userId)
      .execute();
  }
}
