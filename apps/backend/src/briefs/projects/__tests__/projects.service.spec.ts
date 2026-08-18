import { ProjectsService } from '../services/projects.service';

function makeService() {
  const projects = {
    listByOrganization: jest.fn(),
    findByIdScopedToOrg: jest.fn(),
    findByNameInOrg: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };
  const links = {
    listByProject: jest.fn(),
    listRepositoryIdsForProjects: jest.fn(),
    replaceForProject: jest.fn(),
  };
  const repos = {
    findByIdScopedToOrg: jest.fn(),
  };
  const db = {
    transaction: jest.fn(() => ({
      execute: async (fn: any) => fn({}),
    })),
  };
  const svc = new ProjectsService(
    projects as any,
    links as any,
    repos as any,
    db as any,
  );
  return { svc, projects, links, repos, db };
}

describe('ProjectsService', () => {
  describe('create', () => {
    it('rejects when a repositoryId is not reachable from the org', async () => {
      const { svc, repos } = makeService();
      repos.findByIdScopedToOrg.mockResolvedValue(null);
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'P',
          repositoryIds: ['11111111-1111-1111-1111-111111111111'],
        }),
      ).rejects.toMatchObject({ code: 'GITHUB_REPOSITORY_NOT_FOUND' });
    });

    it('rejects on name conflict', async () => {
      const { svc, projects, repos } = makeService();
      repos.findByIdScopedToOrg.mockResolvedValue({ id: 'r1' });
      projects.findByNameInOrg.mockResolvedValue({ id: 'existing' });
      await expect(
        svc.create('org-1', 'user-1', { name: 'P', repositoryIds: [] }),
      ).rejects.toMatchObject({ code: 'PROJECT_NAME_CONFLICT' });
    });

    it('creates and links repositories atomically', async () => {
      const { svc, projects, links } = makeService();
      projects.findByNameInOrg.mockResolvedValue(null);
      projects.create.mockResolvedValue({
        id: 'p1',
        organizationId: 'org-1',
        name: 'P',
        description: null,
        color: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      links.listByProject.mockResolvedValue([]);
      const result = await svc.create('org-1', 'user-1', {
        name: 'P',
        repositoryIds: [],
      });
      expect(projects.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', name: 'P' }),
        expect.any(Object),
      );
      expect(links.replaceForProject).toHaveBeenCalledWith(
        'p1',
        [],
        expect.any(Object),
      );
      expect(result.id).toBe('p1');
    });
  });

  describe('list', () => {
    it('returns projects with linked repository ids', async () => {
      const { svc, projects, links } = makeService();
      projects.listByOrganization.mockResolvedValue([
        {
          id: 'p1',
          name: 'P1',
          organizationId: 'o',
          description: null,
          color: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ]);
      links.listRepositoryIdsForProjects.mockResolvedValue(
        new Map([['p1', ['r1']]]),
      );
      const out = await svc.list('o');
      expect(out[0].repositoryIds).toEqual(['r1']);
    });
  });

  describe('delete', () => {
    it('soft-deletes', async () => {
      const { svc, projects } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue({ id: 'p1' });
      await svc.delete('o', 'p1');
      expect(projects.softDelete).toHaveBeenCalledWith('p1');
    });
    it('throws when missing', async () => {
      const { svc, projects } = makeService();
      projects.findByIdScopedToOrg.mockResolvedValue(null);
      await expect(svc.delete('o', 'p1')).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
    });
  });
});
