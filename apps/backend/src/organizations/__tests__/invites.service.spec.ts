import { InvitesService } from '../services/invites.service';

function mocks() {
  const invites = {
    findById: jest.fn(),
    findByTokenHash: jest.fn(),
    findPendingByOrgAndEmail: jest.fn(),
    listByOrg: jest.fn(),
    listByEmail: jest.fn(),
    create: jest.fn(),
    updateStatus: jest.fn(),
    rotateToken: jest.fn(),
    markAccepted: jest.fn(),
  } as any;
  const members = {
    findByOrgAndUser: jest.fn(),
    listByOrg: jest.fn(),
    create: jest.fn(),
  } as any;
  const orgs = {
    findById: jest.fn(),
  } as any;
  const db = {
    transaction: jest.fn(() => ({
      execute: async (fn: (tx: any) => Promise<any>) => fn({ __tx: true }),
    })),
  } as any;
  const mailer = {
    sendInviteEmail: jest.fn().mockResolvedValue(undefined),
  } as any;
  const config = {
    getOrThrow: jest.fn((key: string) =>
      key === 'FRONTEND_URL' ? 'https://app.example.com' : '',
    ),
  } as any;
  return { invites, members, orgs, db, mailer, config };
}

describe('InvitesService', () => {
  describe('createInvite', () => {
    it('409 when invited email already belongs to a current member', async () => {
      const m = mocks();
      m.members.listByOrg.mockResolvedValue([
        { member: { role: 'admin' }, user: { email: 'jane@example.com' } },
      ]);
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      await expect(
        svc.createInvite({
          organizationId: 'o1',
          inviterUserId: 'u1',
          email: 'jane@example.com',
          role: 'admin',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('flips existing pending invite to expired and inserts a new one in a transaction', async () => {
      const m = mocks();
      m.members.listByOrg.mockResolvedValue([]);
      m.invites.findPendingByOrgAndEmail.mockResolvedValue({
        id: 'old-invite',
      });
      m.invites.create.mockResolvedValue({
        id: 'new-invite',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'viewer',
        status: 'pending',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 7 * 86400_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        invitedByUserId: 'u1',
        acceptedByUserId: null,
        acceptedAt: null,
      });
      m.orgs.findById.mockResolvedValue({
        id: 'o1',
        name: 'Acme',
        slug: 'acme',
        ownerId: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      svc.lookupUser = async () => ({
        id: 'u1',
        name: 'Alice',
        email: 'alice@ex.com',
      });
      const out = await svc.createInvite({
        organizationId: 'o1',
        inviterUserId: 'u1',
        email: 'Bob@Example.com',
        role: 'viewer',
      });

      expect(m.db.transaction).toHaveBeenCalled();
      expect(m.invites.updateStatus).toHaveBeenCalledWith(
        'old-invite',
        'expired',
        expect.anything(),
      );
      expect(m.invites.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'bob@example.com',
          role: 'viewer',
          status: 'pending',
        }),
        expect.anything(),
      );
      expect(m.mailer.sendInviteEmail).toHaveBeenCalledTimes(1);
      expect(out.status).toBe('pending');
    });
  });

  describe('resendInvite', () => {
    it('rejects when invite is not pending', async () => {
      const m = mocks();
      m.invites.findById.mockResolvedValue({
        id: 'i1',
        status: 'accepted',
        organizationId: 'o1',
      });
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      await expect(
        svc.resendInvite({ organizationId: 'o1', inviteId: 'i1' }),
      ).rejects.toMatchObject({ status: 410 });
    });

    it('rotates token and resets expiry', async () => {
      const m = mocks();
      const currentExpiry = new Date(Date.now() + 2 * 86400_000);
      m.invites.findById.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'admin',
        status: 'pending',
        tokenHash: 'old-token-hash',
        expiresAt: currentExpiry,
      });
      m.invites.rotateToken.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'admin',
        status: 'pending',
        tokenHash: 'hash2',
        expiresAt: new Date(Date.now() + 7 * 86400_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        invitedByUserId: 'u1',
        acceptedByUserId: null,
        acceptedAt: null,
      });
      m.orgs.findById.mockResolvedValue({
        id: 'o1',
        name: 'Acme',
        slug: 'acme',
        ownerId: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      svc.lookupUser = async () => ({
        id: 'u1',
        name: 'Alice',
        email: 'alice@ex.com',
      });
      await svc.resendInvite({ organizationId: 'o1', inviteId: 'i1' });
      expect(m.invites.rotateToken).toHaveBeenCalled();
      expect(m.mailer.sendInviteEmail).toHaveBeenCalledTimes(1);
    });

    it('rolls back token rotation and returns 502 when email sending fails', async () => {
      const m = mocks();
      const originalExpiry = new Date(Date.now() + 2 * 86400_000);
      m.invites.findById.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'admin',
        status: 'pending',
        tokenHash: 'old-token-hash',
        expiresAt: originalExpiry,
        invitedByUserId: 'u1',
      });
      m.invites.rotateToken
        .mockResolvedValueOnce({
          id: 'i1',
          organizationId: 'o1',
          email: 'bob@example.com',
          role: 'admin',
          status: 'pending',
          tokenHash: 'new-token-hash',
          expiresAt: new Date(Date.now() + 7 * 86400_000),
          createdAt: new Date(),
          updatedAt: new Date(),
          invitedByUserId: 'u1',
          acceptedByUserId: null,
          acceptedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'i1',
          organizationId: 'o1',
          email: 'bob@example.com',
          role: 'admin',
          status: 'pending',
          tokenHash: 'old-token-hash',
          expiresAt: originalExpiry,
          createdAt: new Date(),
          updatedAt: new Date(),
          invitedByUserId: 'u1',
          acceptedByUserId: null,
          acceptedAt: null,
        });
      m.mailer.sendInviteEmail.mockRejectedValueOnce(new Error('Resend down'));
      m.orgs.findById.mockResolvedValue({
        id: 'o1',
        name: 'Acme',
        slug: 'acme',
        ownerId: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      svc.lookupUser = async () => ({
        id: 'u1',
        name: 'Alice',
        email: 'alice@ex.com',
      });

      await expect(
        svc.resendInvite({ organizationId: 'o1', inviteId: 'i1' }),
      ).rejects.toMatchObject({ status: 502 });

      expect(m.invites.rotateToken).toHaveBeenNthCalledWith(
        1,
        'i1',
        expect.objectContaining({
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
      expect(m.invites.rotateToken).toHaveBeenNthCalledWith(2, 'i1', {
        tokenHash: 'old-token-hash',
        expiresAt: originalExpiry,
      });
      expect(m.mailer.sendInviteEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('revokeInvite', () => {
    it('sets status=revoked for a pending invite', async () => {
      const m = mocks();
      m.invites.findById.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        status: 'pending',
      });
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      await svc.revokeInvite({ organizationId: 'o1', inviteId: 'i1' });
      expect(m.invites.updateStatus).toHaveBeenCalledWith('i1', 'revoked');
    });

    it('is idempotent for non-pending invites (no update)', async () => {
      const m = mocks();
      m.invites.findById.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        status: 'accepted',
      });
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      await svc.revokeInvite({ organizationId: 'o1', inviteId: 'i1' });
      expect(m.invites.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('previewInvite', () => {
    it('returns 404 for unknown token', async () => {
      const m = mocks();
      m.invites.findByTokenHash.mockResolvedValue(null);
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      await expect(svc.previewInvite('tok')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('returns 410 for non-pending or expired', async () => {
      const m = mocks();
      m.invites.findByTokenHash.mockResolvedValue({
        id: 'i1',
        status: 'accepted',
        expiresAt: new Date(Date.now() + 86400_000),
      });
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      await expect(svc.previewInvite('tok')).rejects.toMatchObject({
        status: 410,
      });
    });

    it('returns preview shape for valid pending invite', async () => {
      const m = mocks();
      const future = new Date(Date.now() + 86400_000);
      m.invites.findByTokenHash.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'admin',
        status: 'pending',
        expiresAt: future,
        invitedByUserId: 'u1',
      });
      m.orgs.findById.mockResolvedValue({ id: 'o1', name: 'Acme' });
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      svc.lookupUser = async () => ({
        id: 'u1',
        name: 'Alice',
        email: 'alice@ex.com',
      });

      const preview = await svc.previewInvite('tok');
      expect(preview.organizationName).toBe('Acme');
      expect(preview.inviterName).toBe('Alice');
      expect(preview.invitedEmail).toBe('bob@example.com');
      expect(preview.role).toBe('admin');
      expect(preview.expiresAt).toBe(future.toISOString());
    });
  });

  describe('acceptInvite', () => {
    it('422 when caller email does not match invite email', async () => {
      const m = mocks();
      m.invites.findByTokenHash.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86400_000),
      });
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      await expect(
        svc.acceptInvite({
          caller: {
            userId: 'u1',
            email: 'other@example.com',
            emailVerified: true,
          },
          token: 'tok',
        }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('422 when email is not verified', async () => {
      const m = mocks();
      m.invites.findByTokenHash.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86400_000),
      });
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      await expect(
        svc.acceptInvite({
          caller: {
            userId: 'u1',
            email: 'bob@example.com',
            emailVerified: false,
          },
          token: 'tok',
        }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('410 when invite is expired', async () => {
      const m = mocks();
      m.invites.findByTokenHash.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() - 86400_000),
      });
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      await expect(
        svc.acceptInvite({
          caller: {
            userId: 'u1',
            email: 'bob@example.com',
            emailVerified: true,
          },
          token: 'tok',
        }),
      ).rejects.toMatchObject({ status: 410 });
    });

    it('creates membership + marks accepted in a transaction', async () => {
      const m = mocks();
      m.invites.findByTokenHash.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86400_000),
      });
      m.members.findByOrgAndUser.mockResolvedValue(null);
      m.members.create.mockResolvedValue({
        id: 'm-new',
        organizationId: 'o1',
        userId: 'u1',
        role: 'admin',
        createdAt: new Date(),
      });
      m.orgs.findById.mockResolvedValue({
        id: 'o1',
        name: 'Acme',
        slug: 'acme',
        ownerId: 'u2',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      const out = await svc.acceptInvite({
        caller: { userId: 'u1', email: 'bob@example.com', emailVerified: true },
        token: 'tok',
      });

      expect(m.members.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'o1',
          userId: 'u1',
          role: 'admin',
        }),
        expect.anything(),
      );
      expect(m.invites.markAccepted).toHaveBeenCalledWith(
        'i1',
        'u1',
        expect.any(Date),
        expect.anything(),
      );
      expect(out.organization.id).toBe('o1');
    });

    it('idempotent if caller is already a member', async () => {
      const m = mocks();
      m.invites.findByTokenHash.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86400_000),
      });
      m.members.findByOrgAndUser.mockResolvedValue({
        id: 'm-existing',
        organizationId: 'o1',
        userId: 'u1',
        role: 'viewer',
        createdAt: new Date(),
      });
      m.orgs.findById.mockResolvedValue({
        id: 'o1',
        name: 'Acme',
        slug: 'acme',
        ownerId: 'u2',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      const out = await svc.acceptInvite({
        caller: { userId: 'u1', email: 'bob@example.com', emailVerified: true },
        token: 'tok',
      });

      expect(m.members.create).not.toHaveBeenCalled();
      expect(m.invites.markAccepted).toHaveBeenCalled();
      expect(out.membership.id).toBe('m-existing');
    });
  });

  describe('declineInvite', () => {
    it('flips status to revoked', async () => {
      const m = mocks();
      m.invites.findByTokenHash.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        email: 'bob@example.com',
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86400_000),
      });
      const svc = new InvitesService(
        m.invites,
        m.members,
        m.orgs,
        m.db,
        m.mailer,
        m.config,
      );
      await svc.declineInvite({
        caller: { userId: 'u1', email: 'bob@example.com', emailVerified: true },
        token: 'tok',
      });
      expect(m.invites.updateStatus).toHaveBeenCalledWith('i1', 'revoked');
    });
  });
});
