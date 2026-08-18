import { OrganizationsService } from '../services/organizations.service';

function makeMocks() {
  const orgsRepo = {
    findById: jest.fn(),
    findBySlug: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn().mockResolvedValue(1),
    setOwner: jest.fn(),
    lockById: jest.fn().mockResolvedValue({ id: 'org-1' }),
  } as any;

  const membersRepo = {
    findByOrgAndUser: jest.fn(),
    listByUser: jest.fn(),
    create: jest.fn(),
    updateRole: jest.fn(),
    delete: jest.fn(),
    deleteByOrgAndUser: jest.fn(),
  } as any;

  const db = {
    transaction: jest.fn(() => ({
      execute: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ __tx: true }),
    })),
  } as any;

  const teardown = { run: jest.fn().mockResolvedValue(undefined) } as any;

  return { orgsRepo, membersRepo, db, teardown };
}

/** Shape of a `pg` unique-violation on the organizations.slug index. */
function slugUniqueViolation(opts: { withConstraint?: boolean } = {}): Error {
  const err = new Error(
    'duplicate key value violates unique constraint "organizations_slug_unique"',
  );
  return opts.withConstraint === false
    ? Object.assign(err, { code: '23505' })
    : Object.assign(err, {
        code: '23505',
        constraint: 'organizations_slug_unique',
      });
}

describe('OrganizationsService', () => {
  describe('create', () => {
    it('allows a caller who already owns an org to create another', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      orgsRepo.create.mockResolvedValue({
        id: 'org-2',
        name: 'Second',
        slug: 'second-abc123',
        ownerId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      membersRepo.create.mockResolvedValue({
        id: 'm-2',
        organizationId: 'org-2',
        userId: 'user-1',
        role: 'owner',
        createdAt: new Date(),
      });

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      const result = await svc.createOrganization('user-1', { name: 'Second' });

      expect(result.organization.id).toBe('org-2');
      expect(result.membership.role).toBe('owner');
    });

    it('creates org + owner membership in a transaction', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      orgsRepo.create.mockResolvedValue({
        id: 'org-1',
        name: 'Acme',
        slug: 'acme-abc123',
        ownerId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      membersRepo.create.mockResolvedValue({
        id: 'm-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'owner',
        createdAt: new Date(),
      });

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      const result = await svc.createOrganization('user-1', { name: 'Acme' });

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(orgsRepo.create).toHaveBeenCalledTimes(1);
      expect(membersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          userId: 'user-1',
          role: 'owner',
        }),
        expect.anything(),
      );
      expect(result.organization.id).toBe('org-1');
      expect(result.membership.role).toBe('owner');
    });

    it('retries with a fresh slug on a unique-violation', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      orgsRepo.create
        .mockRejectedValueOnce(slugUniqueViolation({ withConstraint: false }))
        .mockResolvedValueOnce({
          id: 'org-1',
          name: 'Acme',
          slug: 'acme-def456',
          ownerId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      membersRepo.create.mockResolvedValue({
        id: 'm-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: 'owner',
        createdAt: new Date(),
      });

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      const result = await svc.createOrganization('user-1', { name: 'Acme' });

      expect(orgsRepo.create).toHaveBeenCalledTimes(2);
      expect(result.organization.slug).toBe('acme-def456');
    });

    it('surfaces a persistent slug unique-violation as 409, not 500', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      orgsRepo.create.mockRejectedValue(slugUniqueViolation());

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      await expect(
        svc.createOrganization('user-1', { name: 'Acme' }),
      ).rejects.toMatchObject({ status: 409, code: 'ORG_SLUG_CONFLICT' });
    });

    it('rethrows unrelated database errors untouched', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      const err = Object.assign(new Error('members clash'), {
        code: '23505',
        constraint: 'organization_members_org_user_unique',
      });
      orgsRepo.create.mockResolvedValue({
        id: 'org-1',
        name: 'Acme',
        slug: 'acme-abc123',
        ownerId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      membersRepo.create.mockRejectedValue(err);

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      await expect(
        svc.createOrganization('user-1', { name: 'Acme' }),
      ).rejects.toBe(err);
      expect(orgsRepo.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateOrganization', () => {
    it('rejects slug conflicts with 409', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      orgsRepo.findBySlug.mockResolvedValue({ id: 'other', slug: 'taken' });

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      await expect(
        svc.updateOrganization('org-1', { slug: 'taken' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('updates when slug is free', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      orgsRepo.findBySlug.mockResolvedValue(null);
      orgsRepo.update.mockResolvedValue({
        id: 'org-1',
        name: 'Acme',
        slug: 'acme-new',
        ownerId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      const result = await svc.updateOrganization('org-1', {
        slug: 'acme-new',
      });
      expect(result.slug).toBe('acme-new');
    });

    it('maps a racing slug unique-violation to 409, not 500', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      // Pre-check passes: the competing rename was still uncommitted.
      orgsRepo.findBySlug.mockResolvedValue(null);
      orgsRepo.update.mockRejectedValue(slugUniqueViolation());

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      await expect(
        svc.updateOrganization('org-1', { slug: 'taken' }),
      ).rejects.toMatchObject({ status: 409, code: 'ORG_SLUG_CONFLICT' });
    });

    it('rethrows unrelated update errors untouched', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      const err = Object.assign(new Error('boom'), { code: '23503' });
      orgsRepo.update.mockRejectedValue(err);

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      await expect(svc.updateOrganization('org-1', { name: 'x' })).rejects.toBe(
        err,
      );
    });
  });

  describe('deleteOrganization', () => {
    it('tears down integrations and workflows before the delete', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      const order: string[] = [];
      teardown.run.mockImplementation(async () => {
        order.push('teardown');
      });
      orgsRepo.delete.mockImplementation(async () => {
        order.push('delete');
        return 1;
      });

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      await svc.deleteOrganization('org-1');

      expect(teardown.run).toHaveBeenCalledWith('org-1');
      expect(orgsRepo.delete).toHaveBeenCalledWith('org-1');
      expect(order).toEqual(['teardown', 'delete']);
    });

    it('404s when nothing was deleted', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      orgsRepo.delete.mockResolvedValue(0);

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      await expect(svc.deleteOrganization('org-1')).rejects.toMatchObject({
        status: 404,
        code: 'ORG_NOT_FOUND',
      });
    });
  });

  describe('listMyOrganizations', () => {
    it('returns rows shaped as { organization, role }', async () => {
      const { orgsRepo, membersRepo, db, teardown } = makeMocks();
      membersRepo.listByUser.mockResolvedValue([
        {
          organization: {
            id: 'o1',
            name: 'A',
            slug: 'a',
            ownerId: 'u1',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          member: {
            id: 'm1',
            role: 'admin',
            userId: 'u1',
            organizationId: 'o1',
            createdAt: new Date(),
          },
        },
      ]);

      const svc = new OrganizationsService(orgsRepo, membersRepo, db, teardown);
      const out = await svc.listMyOrganizations('u1');
      expect(out).toHaveLength(1);
      expect(out[0].role).toBe('admin');
      expect(out[0].organization.id).toBe('o1');
    });
  });
});
