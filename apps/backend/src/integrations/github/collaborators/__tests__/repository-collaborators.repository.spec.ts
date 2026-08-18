import { RepositoryCollaboratorsRepository } from '../repositories/repository-collaborators.repository';

describe('RepositoryCollaboratorsRepository', () => {
  it('instantiates with a db handle and exposes all methods', () => {
    const repo = new RepositoryCollaboratorsRepository({} as any);

    expect(typeof repo.upsertByRepoCollaborator).toBe('function');
    expect(typeof repo.softDeleteAllForRepo).toBe('function');
    expect(typeof repo.softDeleteMissingForRepo).toBe('function');
    expect(typeof repo.findActiveByRepoId).toBe('function');
  });
});
