import { AgentSessionsRepository } from '../repositories/agent-sessions.repository';

function captureDb() {
  const calls: Array<{ column: string; op: string; value: unknown }> = [];
  const chain: any = {
    selectFrom: () => chain,
    selectAll: () => chain,
    orderBy: () => chain,
    where: (column: string, op: string, value: unknown) => {
      calls.push({ column, op, value });
      return chain;
    },
    execute: async () => [],
    executeTakeFirst: async () => undefined,
    executeTakeFirstOrThrow: async () => ({ count: 0 }),
    select: () => chain,
  };
  return { db: chain, calls };
}

describe('AgentSessionsRepository', () => {
  it('filters listByOrganization by organization and excludes soft-deleted rows', async () => {
    const { db, calls } = captureDb();
    await new AgentSessionsRepository(db).listByOrganization('org-1');
    expect(calls).toContainEqual({
      column: 'organizationId',
      op: '=',
      value: 'org-1',
    });
    expect(calls).toContainEqual({
      column: 'deletedAt',
      op: 'is',
      value: null,
    });
  });

  it('scopes a thread lookup to the organization', async () => {
    const { db, calls } = captureDb();
    await new AgentSessionsRepository(db).findByIdScopedToOrg(
      'thread-1',
      'org-1',
    );
    expect(calls).toContainEqual({
      column: 'id',
      op: '=',
      value: 'thread-1',
    });
    expect(calls).toContainEqual({
      column: 'organizationId',
      op: '=',
      value: 'org-1',
    });
  });
});
