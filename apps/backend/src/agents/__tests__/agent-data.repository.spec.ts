import { AgentDataRepository } from '../repositories/agent-data.repository';

function captureDb() {
  const wheres: Array<{ column: string; op: string; value: unknown }> = [];
  let limit: number | undefined;
  const chain: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'execute') return async () => [];
        if (prop === 'executeTakeFirst') return async () => undefined;
        if (prop === 'where')
          return (column: any, op?: string, value?: unknown) => {
            if (typeof column === 'string')
              wheres.push({ column, op: op as string, value });
            return chain;
          };
        if (prop === 'limit')
          return (n: number) => {
            limit = n;
            return chain;
          };
        return () => chain;
      },
    },
  );
  return { db: chain, wheres, getLimit: () => limit };
}

describe('AgentDataRepository', () => {
  it('scopes every commit search to the organization', async () => {
    const { db, wheres } = captureDb();
    await new AgentDataRepository(db).searchCommits({
      organizationId: 'org-1',
      limit: 20,
      offset: 0,
    });
    expect(wheres).toContainEqual({
      column: 'i.organizationId',
      op: '=',
      value: 'org-1',
    });
  });

  it('caps the page size regardless of the requested limit', async () => {
    const { db, getLimit } = captureDb();
    await new AgentDataRepository(db).searchCommits({
      organizationId: 'org-1',
      limit: 5000,
      offset: 0,
    });
    expect(getLimit()).toBe(100);
  });

  it('scopes grouping reads to the organization', async () => {
    const { db, wheres } = captureDb();
    await new AgentDataRepository(db).listProjects('org-1');
    expect(wheres).toContainEqual({
      column: 'organizationId',
      op: '=',
      value: 'org-1',
    });
  });

  it('scopes a single-commit read to the organization', async () => {
    const { db, wheres } = captureDb();
    await new AgentDataRepository(db).getCommit('org-1', 'commit-1');
    expect(wheres).toContainEqual({
      column: 'i.organizationId',
      op: '=',
      value: 'org-1',
    });
    expect(wheres).toContainEqual({
      column: 'c.id',
      op: '=',
      value: 'commit-1',
    });
  });
});
