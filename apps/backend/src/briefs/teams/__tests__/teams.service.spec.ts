import { TeamsService } from '../services/teams.service';

function makeService() {
  const teams = {
    listByOrganization: jest.fn(),
    findByIdScopedToOrg: jest.fn(),
    findByNameInOrg: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };
  const links = {
    listByTeam: jest.fn(),
    listCollaboratorIdsForTeams: jest.fn(),
    replaceForTeam: jest.fn(),
  };
  const collaborators = {
    findByIdScopedToOrg: jest.fn(),
  };
  const db = {
    transaction: jest.fn(() => ({
      execute: async (fn: any) => fn({}),
    })),
  };
  const svc = new TeamsService(
    teams as any,
    links as any,
    collaborators as any,
    db as any,
  );
  return { svc, teams, links, collaborators, db };
}

describe('TeamsService', () => {
  describe('create', () => {
    it('rejects when a collaboratorId is not reachable from the org', async () => {
      const { svc, collaborators } = makeService();
      collaborators.findByIdScopedToOrg.mockResolvedValue(null);
      await expect(
        svc.create('org-1', 'user-1', {
          name: 'T',
          collaboratorIds: ['11111111-1111-1111-1111-111111111111'],
        }),
      ).rejects.toMatchObject({ code: 'GITHUB_COLLABORATOR_NOT_FOUND' });
    });

    it('rejects on name conflict', async () => {
      const { svc, teams, collaborators } = makeService();
      collaborators.findByIdScopedToOrg.mockResolvedValue({ id: 'c1' });
      teams.findByNameInOrg.mockResolvedValue({ id: 'existing' });
      await expect(
        svc.create('org-1', 'user-1', { name: 'T', collaboratorIds: [] }),
      ).rejects.toMatchObject({ code: 'TEAM_NAME_CONFLICT' });
    });

    it('creates and links collaborators atomically', async () => {
      const { svc, teams, links } = makeService();
      teams.findByNameInOrg.mockResolvedValue(null);
      teams.create.mockResolvedValue({
        id: 't1',
        organizationId: 'org-1',
        name: 'T',
        description: null,
        color: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      links.listByTeam.mockResolvedValue([]);
      const result = await svc.create('org-1', 'user-1', {
        name: 'T',
        collaboratorIds: [],
      });
      expect(teams.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', name: 'T' }),
        expect.any(Object),
      );
      expect(links.replaceForTeam).toHaveBeenCalledWith(
        't1',
        [],
        expect.any(Object),
      );
      expect(result.id).toBe('t1');
    });
  });

  describe('list', () => {
    it('returns teams with linked collaborator ids', async () => {
      const { svc, teams, links } = makeService();
      teams.listByOrganization.mockResolvedValue([
        {
          id: 't1',
          name: 'T1',
          organizationId: 'o',
          description: null,
          color: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ]);
      links.listCollaboratorIdsForTeams.mockResolvedValue(
        new Map([['t1', ['c1']]]),
      );
      const out = await svc.list('o');
      expect(out[0].collaboratorIds).toEqual(['c1']);
    });
  });

  describe('delete', () => {
    it('soft-deletes', async () => {
      const { svc, teams } = makeService();
      teams.findByIdScopedToOrg.mockResolvedValue({ id: 't1' });
      await svc.delete('o', 't1');
      expect(teams.softDelete).toHaveBeenCalledWith('t1');
    });
    it('throws when missing', async () => {
      const { svc, teams } = makeService();
      teams.findByIdScopedToOrg.mockResolvedValue(null);
      await expect(svc.delete('o', 't1')).rejects.toMatchObject({
        code: 'TEAM_NOT_FOUND',
      });
    });
  });
});
