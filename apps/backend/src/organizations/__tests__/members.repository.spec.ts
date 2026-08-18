import { OrganizationMembersRepository } from '../repositories/members.repository';

describe('OrganizationMembersRepository', () => {
  it('instantiates and exposes all methods', () => {
    const repo = new OrganizationMembersRepository({} as any);
    expect(typeof repo.findByOrgAndUser).toBe('function');
    expect(typeof repo.listByOrg).toBe('function');
    expect(typeof repo.listByUser).toBe('function');
    expect(typeof repo.create).toBe('function');
    expect(typeof repo.updateRole).toBe('function');
    expect(typeof repo.delete).toBe('function');
    expect(typeof repo.deleteByOrgAndUser).toBe('function');
  });
});
