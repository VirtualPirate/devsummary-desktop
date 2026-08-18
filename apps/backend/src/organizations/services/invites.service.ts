import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  InvitePreview,
  InviteRole,
  InviteStatus,
  Organization,
  OrganizationInvite,
} from '@launchstack/api-interfaces';
import { KYSELY_DB } from '../../databases/kysely';
import type {
  AppDatabase,
  OrganizationMemberSelect,
} from '../../databases/kysely';
import { OrganizationsRepository } from '../repositories/organizations.repository';
import { OrganizationMembersRepository } from '../repositories/members.repository';
import {
  InviteWithRefs,
  OrganizationInvitesRepository,
} from '../repositories/invites.repository';
import { generateInviteToken, hashInviteToken } from '../tokens';
import { serializeOrganization } from './organizations.service';
import { InviteMailer } from './invite-mailer';
import { AppError } from '../../common/errors';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function serializeInvite(row: InviteWithRefs): OrganizationInvite {
  return {
    id: row.invite.id,
    organizationId: row.invite.organizationId,
    email: row.invite.email,
    role: row.invite.role,
    status: row.invite.status,
    expiresAt: row.invite.expiresAt.toISOString(),
    createdAt: row.invite.createdAt.toISOString(),
    invitedBy: row.invitedBy ?? null,
    acceptedBy: null,
    acceptedAt: row.invite.acceptedAt
      ? row.invite.acceptedAt.toISOString()
      : null,
  };
}

interface CallerContext {
  userId: string;
  email: string;
  emailVerified: boolean;
}

@Injectable()
export class InvitesService {
  constructor(
    private readonly invites: OrganizationInvitesRepository,
    private readonly members: OrganizationMembersRepository,
    private readonly orgs: OrganizationsRepository,
    @Inject(KYSELY_DB) private readonly db: AppDatabase,
    private readonly mailer: InviteMailer,
    private readonly config: ConfigService,
  ) {}

  /** Hook-point for tests to stub user lookups (used by previewInvite). */
  lookupUser: (
    userId: string,
  ) => Promise<{ id: string; name: string; email: string } | null> = async (
    userId,
  ) => {
    const row = await this.db
      .selectFrom('auth.user')
      .select(['id', 'name', 'email'])
      .where('id', '=', userId)
      .limit(1)
      .executeTakeFirst();
    return row ?? null;
  };

  private buildAcceptUrl(rawToken: string): string {
    const base = this.config.getOrThrow<string>('FRONTEND_URL');
    const url = new URL('/accept-invite', base);
    url.searchParams.set('token', rawToken);
    return url.toString();
  }

  private requireVerifiedCaller(caller: CallerContext) {
    if (!caller.emailVerified) {
      throw AppError.EMAIL_NOT_VERIFIED();
    }
  }

  async createInvite(input: {
    organizationId: string;
    inviterUserId: string;
    email: string;
    role: InviteRole;
  }): Promise<OrganizationInvite> {
    const email = input.email.trim().toLowerCase();

    const existingMembers = await this.members.listByOrg(input.organizationId);
    if (existingMembers.some((m) => m.user.email.toLowerCase() === email)) {
      throw AppError.INVITE_TARGET_IS_MEMBER();
    }

    const rawToken = generateInviteToken();
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const created = await this.db.transaction().execute(async (tx) => {
      const existing = await this.invites.findPendingByOrgAndEmail(
        input.organizationId,
        email,
        tx,
      );
      if (existing) {
        await this.invites.updateStatus(existing.id, 'expired', tx);
      }
      return this.invites.create(
        {
          organizationId: input.organizationId,
          email,
          role: input.role,
          tokenHash,
          status: 'pending',
          expiresAt,
          invitedByUserId: input.inviterUserId,
        },
        tx,
      );
    });

    const org = await this.orgs.findById(input.organizationId);
    const inviter = await this.lookupUser(input.inviterUserId);
    await this.mailer.sendInviteEmail({
      to: email,
      organizationName: org?.name ?? 'your organization',
      inviterName: inviter?.name ?? 'A teammate',
      role: input.role,
      acceptUrl: this.buildAcceptUrl(rawToken),
      expiresInDays: 7,
    });

    return serializeInvite({
      invite: created,
      organization: org!,
      invitedBy: inviter,
    });
  }

  async listOrganizationInvites(
    organizationId: string,
    status: InviteStatus | 'all',
  ): Promise<OrganizationInvite[]> {
    const rows = await this.invites.listByOrg(organizationId, { status });
    return rows.map(serializeInvite);
  }

  async listMyInvites(email: string): Promise<OrganizationInvite[]> {
    const rows = await this.invites.listByEmail(email.trim().toLowerCase(), {
      status: 'pending',
      notExpiredAfter: new Date(),
    });
    return rows.map(serializeInvite);
  }

  async revokeInvite(input: {
    organizationId: string;
    inviteId: string;
  }): Promise<void> {
    const row = await this.invites.findById(input.inviteId);
    if (!row || row.organizationId !== input.organizationId) {
      throw AppError.INVITE_NOT_FOUND();
    }
    if (row.status !== 'pending') return;
    await this.invites.updateStatus(row.id, 'revoked');
  }

  async resendInvite(input: {
    organizationId: string;
    inviteId: string;
  }): Promise<OrganizationInvite> {
    const row = await this.invites.findById(input.inviteId);
    if (!row || row.organizationId !== input.organizationId) {
      throw AppError.INVITE_NOT_FOUND();
    }
    if (row.status !== 'pending') {
      throw AppError.INVITE_NOT_PENDING();
    }

    const rawToken = generateInviteToken();
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const previousToken = {
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
    };

    const updated = await this.invites.rotateToken(row.id, {
      tokenHash,
      expiresAt,
    });
    const org = await this.orgs.findById(input.organizationId);
    const inviter = row.invitedByUserId
      ? await this.lookupUser(row.invitedByUserId)
      : null;
    try {
      await this.mailer.sendInviteEmail({
        to: row.email,
        organizationName: org?.name ?? 'your organization',
        inviterName: inviter?.name ?? 'A teammate',
        role: row.role,
        acceptUrl: this.buildAcceptUrl(rawToken),
        expiresInDays: 7,
      });
    } catch (err) {
      await this.invites.rotateToken(row.id, previousToken);
      const reason = err instanceof Error ? err.message : 'unknown error';
      throw AppError.INVITE_RESEND_FAILED({ reason });
    }

    return serializeInvite({
      invite: updated!,
      organization: org!,
      invitedBy: inviter,
    });
  }

  async previewInvite(rawToken: string): Promise<InvitePreview> {
    const row = await this.invites.findByTokenHash(hashInviteToken(rawToken));
    if (!row) {
      throw AppError.INVITE_NOT_FOUND();
    }
    if (row.status !== 'pending' || row.expiresAt <= new Date()) {
      throw AppError.INVITE_NOT_PENDING();
    }
    const org = await this.orgs.findById(row.organizationId);
    const inviter = row.invitedByUserId
      ? await this.lookupUser(row.invitedByUserId)
      : null;
    return {
      organizationName: org?.name ?? 'Organization',
      inviterName: inviter?.name ?? null,
      invitedEmail: row.email,
      role: row.role,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  private async resolveInvite(identifier: {
    token?: string;
    inviteId?: string;
  }) {
    if (identifier.token) {
      const row = await this.invites.findByTokenHash(
        hashInviteToken(identifier.token),
      );
      return row;
    }
    if (identifier.inviteId) {
      return this.invites.findById(identifier.inviteId);
    }
    return null;
  }

  async acceptInvite(input: {
    caller: CallerContext;
    token?: string;
    inviteId?: string;
  }): Promise<{
    organization: Organization;
    membership: OrganizationMemberSelect;
  }> {
    this.requireVerifiedCaller(input.caller);

    const row = await this.resolveInvite({
      token: input.token,
      inviteId: input.inviteId,
    });
    if (!row) {
      throw AppError.INVITE_NOT_FOUND();
    }
    if (row.email.toLowerCase() !== input.caller.email.toLowerCase()) {
      throw AppError.INVITE_EMAIL_MISMATCH();
    }
    if (row.status !== 'pending') {
      throw AppError.INVITE_NOT_PENDING();
    }
    if (row.expiresAt <= new Date()) {
      throw AppError.INVITE_EXPIRED();
    }

    const result = await this.db.transaction().execute(async (tx) => {
      const existing = await this.members.findByOrgAndUser(
        row.organizationId,
        input.caller.userId,
        tx,
      );
      const membership =
        existing ??
        (await this.members.create(
          {
            organizationId: row.organizationId,
            userId: input.caller.userId,
            role: row.role,
          },
          tx,
        ));
      await this.invites.markAccepted(
        row.id,
        input.caller.userId,
        new Date(),
        tx,
      );
      return { membership };
    });

    const org = await this.orgs.findById(row.organizationId);
    if (!org) {
      throw AppError.ORG_NOT_FOUND();
    }
    return {
      organization: serializeOrganization(org),
      membership: result.membership,
    };
  }

  async declineInvite(input: {
    caller: CallerContext;
    token?: string;
    inviteId?: string;
  }): Promise<void> {
    this.requireVerifiedCaller(input.caller);
    const row = await this.resolveInvite({
      token: input.token,
      inviteId: input.inviteId,
    });
    if (!row) {
      throw AppError.INVITE_NOT_FOUND();
    }
    if (row.email.toLowerCase() !== input.caller.email.toLowerCase()) {
      throw AppError.INVITE_EMAIL_MISMATCH();
    }
    if (row.status !== 'pending') return;
    await this.invites.updateStatus(row.id, 'revoked');
  }
}
