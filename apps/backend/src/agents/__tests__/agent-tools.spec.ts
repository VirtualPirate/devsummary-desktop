import { buildAgentTools } from '../agent-tools';

function deps() {
  const seen: Array<Record<string, unknown>> = [];
  return {
    seen,
    tools: buildAgentTools('org-1', {
      data: {
        listRepositories: (organizationId: string) => {
          seen.push({ call: 'listRepositories', organizationId });
          return Promise.resolve([]);
        },
        searchCommits: (input: Record<string, unknown>) => {
          seen.push({ call: 'searchCommits', ...input });
          return Promise.resolve([]);
        },
        getCommit: (organizationId: string, commitId: string) => {
          seen.push({ call: 'getCommit', organizationId, commitId });
          return Promise.resolve(null);
        },
        listProjects: () => Promise.resolve([]),
        listTeams: () => Promise.resolve([]),
      },
      collaborators: { listByOrganization: () => Promise.resolve([]) },
      analytics: {
        getCommitActivity: (
          organizationId: string,
          query: Record<string, unknown>,
        ) => {
          seen.push({ call: 'activity', organizationId, ...query });
          return Promise.resolve({ points: [], range: query });
        },
      },
    } as never),
  };
}

// Each tool has its own argument schema, so the array is a union whose
// `invoke` overloads do not line up. The tests call them the way the model
// does — a bag of arguments — so narrow to that shape here.
function tool(tools: ReturnType<typeof buildAgentTools>, name: string) {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found as unknown as {
    invoke: (input: Record<string, unknown>) => Promise<unknown>;
  };
}

describe('buildAgentTools', () => {
  it('exposes exactly the read-only surface', () => {
    expect(deps().tools.map((t) => t.name)).toEqual([
      'list_repositories',
      'list_collaborators',
      'search_commits',
      'get_commit',
      'list_projects',
      'list_teams',
      'activity_stats',
    ]);
  });

  it('passes the bound organization, never one from the arguments', async () => {
    const { tools, seen } = deps();
    await tool(tools, 'search_commits').invoke({
      // What a confused model sends. It must not reach the query.
      organizationId: 'org-2',
      authorLogin: 'octocat',
    });
    expect(seen[0]).toMatchObject({
      call: 'searchCommits',
      organizationId: 'org-1',
      authorLogin: 'octocat',
    });
    expect(seen[0]).not.toHaveProperty('organizationId', 'org-2');
  });

  it('stamps today on every answer, because the model has no other clock', async () => {
    const { tools } = deps();
    const result = JSON.parse(
      (await tool(tools, 'list_repositories').invoke({})) as string,
    ) as { today: string };
    expect(result.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reports a bad window as an answer, not an exception', async () => {
    const { tools, seen } = deps();
    const result = JSON.parse(
      (await tool(tools, 'activity_stats').invoke({
        from: '2020-01-01T00:00:00Z',
        to: '2020-02-01T00:00:00Z',
      })) as string,
    ) as { error?: string };
    expect(result.error).toMatch(/over a year ago/);
    // Nothing was read: a refused window must not reach the database.
    expect(seen).toEqual([]);
  });

  it('resolves a relative lookback into the shared analytics query', async () => {
    const { tools, seen } = deps();
    await tool(tools, 'activity_stats').invoke({
      days: 7,
      granularity: 'week',
    });
    expect(seen[0]).toMatchObject({
      call: 'activity',
      organizationId: 'org-1',
      granularity: 'week',
      timezone: 'UTC',
    });
  });

  it('rejects a commit id that is not a uuid before it reaches SQL', async () => {
    const { tools } = deps();
    await expect(
      tool(tools, 'get_commit').invoke({ commitId: '1; drop table commits' }),
    ).rejects.toThrow();
  });
});
