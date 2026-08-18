import { GithubInstallationsRepository } from '../repositories/installations.repository';

describe('GithubInstallationsRepository', () => {
  it('instantiates with a db handle and exposes all methods', () => {
    const repo = new GithubInstallationsRepository({} as any);

    expect(typeof repo.findById).toBe('function');
    expect(typeof repo.findActiveByGithubInstallationId).toBe('function');
    expect(typeof repo.findRevivableByGithubInstallationId).toBe('function');
    expect(typeof repo.findByIdScopedToOrg).toBe('function');
    expect(typeof repo.listByOrganization).toBe('function');
    expect(typeof repo.create).toBe('function');
    expect(typeof repo.softDelete).toBe('function');
    expect(typeof repo.undelete).toBe('function');
    expect(typeof repo.findByIdIncludingDeleted).toBe('function');
  });
});
