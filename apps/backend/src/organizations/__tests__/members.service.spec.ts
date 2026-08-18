import { MembersService } from '../services/members.service';

function mocks() {
  const members = {
    findByOrgAndUser: jest.fn(),
    listByOrg: jest.fn(),
    create: jest.fn(),
    updateRole: jest.fn(),
    delete: jest.fn(),
    deleteByOrgAndUser: jest.fn(),
  } as any;
  const memberById = async (id: string) =>
    id === 'm-owner' ? { id, role: 'owner' } : { id, role: 'admin' };
  return { members, memberById };
}

describe('MembersService', () => {
  describe('updateMemberRole', () => {
    it("rejects when trying to change owner's role", async () => {
      const { members } = mocks();
      members.listByOrg.mockResolvedValue([
        {
          member: {
            id: 'm-owner',
            role: 'owner',
            userId: 'u1',
            organizationId: 'o1',
            createdAt: new Date(),
          },
          user: { id: 'u1', name: '', email: '', image: null },
        },
        {
          member: {
            id: 'm-admin',
            role: 'admin',
            userId: 'u2',
            organizationId: 'o1',
            createdAt: new Date(),
          },
          user: { id: 'u2', name: '', email: '', image: null },
        },
      ]);
      const svc = new MembersService(members);
      await expect(
        svc.updateMemberRole({
          organizationId: 'o1',
          memberId: 'm-owner',
          newRole: 'admin',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("updates an admin's role", async () => {
      const { members } = mocks();
      members.listByOrg.mockResolvedValue([
        {
          member: {
            id: 'm-admin',
            role: 'admin',
            userId: 'u2',
            organizationId: 'o1',
            createdAt: new Date(),
          },
          user: { id: 'u2', name: '', email: '', image: null },
        },
      ]);
      members.updateRole.mockResolvedValue({
        id: 'm-admin',
        role: 'viewer',
        userId: 'u2',
        organizationId: 'o1',
        createdAt: new Date(),
      });
      const svc = new MembersService(members);
      const out = await svc.updateMemberRole({
        organizationId: 'o1',
        memberId: 'm-admin',
        newRole: 'viewer',
      });
      expect(out.role).toBe('viewer');
    });
  });

  describe('removeMember', () => {
    it('admin cannot remove the owner', async () => {
      const { members } = mocks();
      members.listByOrg.mockResolvedValue([
        {
          member: {
            id: 'm-owner',
            role: 'owner',
            userId: 'u1',
            organizationId: 'o1',
            createdAt: new Date(),
          },
          user: { id: 'u1', name: '', email: '', image: null },
        },
      ]);
      const svc = new MembersService(members);
      await expect(
        svc.removeMember({
          organizationId: 'o1',
          callerMembership: {
            id: 'm-admin',
            role: 'admin',
            userId: 'u2',
          } as any,
          targetMemberId: 'm-owner',
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('admin cannot remove self (must use leave)', async () => {
      const { members } = mocks();
      members.listByOrg.mockResolvedValue([
        {
          member: {
            id: 'm-admin',
            role: 'admin',
            userId: 'u2',
            organizationId: 'o1',
            createdAt: new Date(),
          },
          user: { id: 'u2', name: '', email: '', image: null },
        },
      ]);
      const svc = new MembersService(members);
      await expect(
        svc.removeMember({
          organizationId: 'o1',
          callerMembership: {
            id: 'm-admin',
            role: 'admin',
            userId: 'u2',
          } as any,
          targetMemberId: 'm-admin',
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('owner can remove an admin', async () => {
      const { members } = mocks();
      members.listByOrg.mockResolvedValue([
        {
          member: {
            id: 'm-admin',
            role: 'admin',
            userId: 'u2',
            organizationId: 'o1',
            createdAt: new Date(),
          },
          user: { id: 'u2', name: '', email: '', image: null },
        },
      ]);
      const svc = new MembersService(members);
      await svc.removeMember({
        organizationId: 'o1',
        callerMembership: { id: 'm-owner', role: 'owner', userId: 'u1' } as any,
        targetMemberId: 'm-admin',
      });
      expect(members.delete).toHaveBeenCalledWith('m-admin');
    });
  });

  describe('leaveOrganization', () => {
    it('rejects owner leaving', async () => {
      const { members } = mocks();
      const svc = new MembersService(members);
      await expect(
        svc.leaveOrganization({
          organizationId: 'o1',
          callerMembership: {
            id: 'm-owner',
            role: 'owner',
            userId: 'u1',
          } as any,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("deletes the caller's membership when admin", async () => {
      const { members } = mocks();
      const svc = new MembersService(members);
      await svc.leaveOrganization({
        organizationId: 'o1',
        callerMembership: { id: 'm-admin', role: 'admin', userId: 'u2' } as any,
      });
      expect(members.deleteByOrgAndUser).toHaveBeenCalledWith('o1', 'u2');
    });
  });
});
