import { Injectable } from '@nestjs/common';
import type {
  OrganizationMember,
  OrganizationRole,
} from '@launchstack/api-interfaces';
import { OrganizationMembersRepository } from '../repositories/members.repository';
import type { OrgMembershipContext } from '../decorators/org-membership.decorator';
import type { MemberRowWithUser } from '../repositories/members.repository';
import { AppError } from '../../common/errors';

function serializeMember(row: MemberRowWithUser): OrganizationMember {
  return {
    id: row.member.id,
    organizationId: row.member.organizationId,
    userId: row.member.userId,
    role: row.member.role,
    user: {
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      image: row.user.image ?? null,
    },
    createdAt: row.member.createdAt.toISOString(),
  };
}

@Injectable()
export class MembersService {
  constructor(private readonly members: OrganizationMembersRepository) {}

  async listMembers(organizationId: string): Promise<OrganizationMember[]> {
    const rows = await this.members.listByOrg(organizationId);
    return rows.map(serializeMember);
  }

  async updateMemberRole(input: {
    organizationId: string;
    memberId: string;
    newRole: Exclude<OrganizationRole, 'owner'>;
  }): Promise<OrganizationMember> {
    const rows = await this.members.listByOrg(input.organizationId);
    const target = rows.find((r) => r.member.id === input.memberId);
    if (!target) {
      throw AppError.MEMBER_NOT_FOUND();
    }
    if (target.member.role === 'owner') {
      throw AppError.MEMBER_IS_OWNER();
    }
    const updated = await this.members.updateRole(
      input.memberId,
      input.newRole,
    );
    if (!updated) {
      throw AppError.MEMBER_NOT_FOUND();
    }
    return serializeMember({ member: updated, user: target.user });
  }

  async removeMember(input: {
    organizationId: string;
    callerMembership: OrgMembershipContext;
    targetMemberId: string;
  }): Promise<void> {
    const rows = await this.members.listByOrg(input.organizationId);
    const target = rows.find((r) => r.member.id === input.targetMemberId);
    if (!target) {
      throw AppError.MEMBER_NOT_FOUND();
    }

    const callerRole = input.callerMembership.role;

    if (target.member.role === 'owner') {
      throw AppError.MEMBER_REMOVE_OWNER_FORBIDDEN();
    }

    if (target.member.userId === input.callerMembership.userId) {
      throw AppError.MEMBER_REMOVE_SELF_FORBIDDEN();
    }

    if (callerRole !== 'owner' && callerRole !== 'admin') {
      throw AppError.MEMBER_INSUFFICIENT_ROLE();
    }

    await this.members.delete(input.targetMemberId);
  }

  async leaveOrganization(input: {
    organizationId: string;
    callerMembership: OrgMembershipContext;
  }): Promise<void> {
    if (input.callerMembership.role === 'owner') {
      throw AppError.OWNER_CANNOT_LEAVE();
    }
    await this.members.deleteByOrgAndUser(
      input.organizationId,
      input.callerMembership.userId,
    );
  }
}
