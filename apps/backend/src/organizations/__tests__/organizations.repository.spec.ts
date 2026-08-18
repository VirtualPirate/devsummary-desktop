import { OrganizationsRepository } from '../repositories/organizations.repository';

describe('OrganizationsRepository', () => {
  it('instantiates with a db handle and exposes all methods', () => {
    const repo = new OrganizationsRepository({} as any);
    expect(typeof repo.findById).toBe('function');
    expect(typeof repo.findBySlug).toBe('function');
    expect(typeof repo.create).toBe('function');
    expect(typeof repo.update).toBe('function');
    expect(typeof repo.delete).toBe('function');
    expect(typeof repo.setOwner).toBe('function');
    expect(typeof repo.lockById).toBe('function');
  });
});
