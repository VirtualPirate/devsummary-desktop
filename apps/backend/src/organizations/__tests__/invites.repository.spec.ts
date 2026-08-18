import { OrganizationInvitesRepository } from '../repositories/invites.repository';

describe('OrganizationInvitesRepository', () => {
  it('instantiates and exposes all methods', () => {
    const repo = new OrganizationInvitesRepository({} as any);
    expect(typeof repo.findById).toBe('function');
    expect(typeof repo.findByTokenHash).toBe('function');
    expect(typeof repo.findPendingByOrgAndEmail).toBe('function');
    expect(typeof repo.listByOrg).toBe('function');
    expect(typeof repo.listByEmail).toBe('function');
    expect(typeof repo.create).toBe('function');
    expect(typeof repo.updateStatus).toBe('function');
    expect(typeof repo.rotateToken).toBe('function');
    expect(typeof repo.markAccepted).toBe('function');
  });
});
