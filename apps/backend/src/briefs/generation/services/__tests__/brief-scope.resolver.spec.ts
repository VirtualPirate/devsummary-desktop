import { BriefScopeResolver } from '../brief-scope.resolver';

function makeResolver() {
  const projects = { findByIdScopedToOrg: jest.fn() };
  const projectLinks = { listByProject: jest.fn() };
  const teams = { findByIdScopedToOrg: jest.fn() };
  const teamLinks = { listByTeam: jest.fn() };
  const collaborators = { findByIdScopedToOrg: jest.fn(), findById: jest.fn() };
  const repos = {
    findByIdScopedToOrg: jest.fn(),
    listIdsByOrganization: jest.fn(),
  };
  const resolver = new BriefScopeResolver(
    projects as any,
    projectLinks as any,
    teams as any,
    teamLinks as any,
    collaborators as any,
    repos as any,
  );
  return {
    resolver,
    projects,
    projectLinks,
    teams,
    teamLinks,
    collaborators,
    repos,
  };
}

describe('BriefScopeResolver.resolve', () => {
  it('project scope → repository ids from project links', async () => {
    const { resolver, projects, projectLinks, repos } = makeResolver();
    projects.findByIdScopedToOrg.mockResolvedValue({
      id: 'p1',
      name: 'Mobile',
    });
    projectLinks.listByProject.mockResolvedValue([
      { repositoryId: 'r1' },
      { repositoryId: 'r2' },
    ]);
    repos.listIdsByOrganization.mockResolvedValue(['r1', 'r2', 'r3']);
    const out = await resolver.resolve({
      organizationId: 'o1',
      scope: { type: 'project', projectId: 'p1' },
    });
    expect(out.repositoryIds).toEqual(['r1', 'r2']);
    expect(out.scopeLabel).toBe('Project: Mobile');
    expect(out.authorFilter).toBeUndefined();
  });

  it('project scope → drops linked repositories that are no longer live in the org', async () => {
    const { resolver, projects, projectLinks, repos } = makeResolver();
    projects.findByIdScopedToOrg.mockResolvedValue({
      id: 'p1',
      name: 'Mobile',
    });
    projectLinks.listByProject.mockResolvedValue([
      { repositoryId: 'r1' },
      { repositoryId: 'disconnected' },
    ]);
    repos.listIdsByOrganization.mockResolvedValue(['r1']);
    const out = await resolver.resolve({
      organizationId: 'o1',
      scope: { type: 'project', projectId: 'p1' },
    });
    expect(out.repositoryIds).toEqual(['r1']);
    expect(repos.listIdsByOrganization).toHaveBeenCalledWith('o1');
  });

  it('project scope → resolves to no repositories when every link is stale', async () => {
    const { resolver, projects, projectLinks, repos } = makeResolver();
    projects.findByIdScopedToOrg.mockResolvedValue({
      id: 'p1',
      name: 'Mobile',
    });
    projectLinks.listByProject.mockResolvedValue([{ repositoryId: 'gone' }]);
    repos.listIdsByOrganization.mockResolvedValue(['r1', 'r2']);
    const out = await resolver.resolve({
      organizationId: 'o1',
      scope: { type: 'project', projectId: 'p1' },
    });
    expect(out.repositoryIds).toEqual([]);
  });

  it('project scope → throws SCOPE_DELETED when missing', async () => {
    const { resolver, projects } = makeResolver();
    projects.findByIdScopedToOrg.mockResolvedValue(null);
    await expect(
      resolver.resolve({
        organizationId: 'o1',
        scope: { type: 'project', projectId: 'p1' },
      }),
    ).rejects.toThrow(/SCOPE_DELETED/);
  });

  it('team scope → org repos plus author filter from members', async () => {
    const { resolver, teams, teamLinks, collaborators, repos } = makeResolver();
    teams.findByIdScopedToOrg.mockResolvedValue({ id: 't1', name: 'Core' });
    teamLinks.listByTeam.mockResolvedValue([{ collaboratorId: 'c1' }]);
    collaborators.findById.mockResolvedValue({
      id: 'c1',
      githubUserId: BigInt(7),
    });
    repos.listIdsByOrganization.mockResolvedValue(['r1', 'r2']);
    const out = await resolver.resolve({
      organizationId: 'o1',
      scope: { type: 'team', teamId: 't1' },
    });
    expect(out.repositoryIds).toEqual(['r1', 'r2']);
    expect(out.scopeLabel).toBe('Team: Core');
    expect(out.authorFilter).toEqual([BigInt(7)]);
  });

  it('team scope with no members → empty scope, never the whole org', async () => {
    const { resolver, teams, teamLinks, repos } = makeResolver();
    teams.findByIdScopedToOrg.mockResolvedValue({
      id: 't1',
      name: 'Contractors',
    });
    teamLinks.listByTeam.mockResolvedValue([]);
    repos.listIdsByOrganization.mockResolvedValue(['r1', 'r2']);
    const out = await resolver.resolve({
      organizationId: 'o1',
      scope: { type: 'team', teamId: 't1' },
    });
    expect(out.repositoryIds).toEqual([]);
    expect(out.authorFilter).toEqual([]);
    expect(out.scopeLabel).toBe('Team: Contractors');
    expect(repos.listIdsByOrganization).not.toHaveBeenCalled();
  });

  it('team scope whose last member was removed → empty scope', async () => {
    const { resolver, teams, teamLinks, collaborators, repos } = makeResolver();
    teams.findByIdScopedToOrg.mockResolvedValue({ id: 't1', name: 'Core' });
    teamLinks.listByTeam.mockResolvedValue([{ collaboratorId: 'c1' }]);
    collaborators.findById.mockResolvedValue(null);
    repos.listIdsByOrganization.mockResolvedValue(['r1', 'r2']);
    const out = await resolver.resolve({
      organizationId: 'o1',
      scope: { type: 'team', teamId: 't1' },
    });
    expect(out.repositoryIds).toEqual([]);
    expect(out.authorFilter).toEqual([]);
    expect(repos.listIdsByOrganization).not.toHaveBeenCalled();
  });

  it('collaborator scope → org repos plus single-author filter', async () => {
    const { resolver, collaborators, repos } = makeResolver();
    collaborators.findByIdScopedToOrg.mockResolvedValue({
      id: 'c1',
      login: 'ada',
      githubUserId: BigInt(9),
    });
    repos.listIdsByOrganization.mockResolvedValue(['r1']);
    const out = await resolver.resolve({
      organizationId: 'o1',
      scope: { type: 'collaborator', collaboratorId: 'c1' },
    });
    expect(out.authorFilter).toEqual([BigInt(9)]);
    expect(out.scopeLabel).toBe('Collaborator: ada');
  });

  it('repository scope → single repository id', async () => {
    const { resolver, repos } = makeResolver();
    repos.findByIdScopedToOrg.mockResolvedValue({
      id: 'r1',
      fullName: 'org/repo',
    });
    const out = await resolver.resolve({
      organizationId: 'o1',
      scope: { type: 'repository', repositoryId: 'r1' },
    });
    expect(out.repositoryIds).toEqual(['r1']);
    expect(out.scopeLabel).toBe('Repository: org/repo');
  });
});
