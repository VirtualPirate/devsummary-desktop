import { CollaboratorsRepository } from '../repositories/collaborators.repository';

function makeAuthor(githubUserId: bigint, login: string) {
  return {
    githubUserId,
    login,
    nodeId: null,
    avatarUrl: null,
    htmlUrl: null,
    type: 'User',
    siteAdmin: false,
    raw: { id: Number(githubUserId), login },
  };
}

describe('CollaboratorsRepository', () => {
  it('instantiates with a db handle and exposes all methods', () => {
    const repo = new CollaboratorsRepository({} as any);

    expect(typeof repo.findById).toBe('function');
    expect(typeof repo.findByGithubUserId).toBe('function');
    expect(typeof repo.upsertByGithubUserId).toBe('function');
    expect(typeof repo.upsertManyFromCommitAuthors).toBe('function');
    expect(typeof repo.listByOrganization).toBe('function');
  });

  describe('upsertManyFromCommitAuthors', () => {
    // Postgres rejects an ON CONFLICT DO UPDATE that touches the same row twice
    // in one statement, and a page of commits is normally one author repeated.
    it('collapses repeated authors to one row per GitHub user id', async () => {
      let values: any[] = [];
      const chain: any = {
        values: (rows: any[]) => {
          values = rows;
          return chain;
        },
        onConflict: () => chain,
        execute: () => Promise.resolve(undefined),
      };
      const repo = new CollaboratorsRepository({
        insertInto: () => chain,
      } as never);

      await repo.upsertManyFromCommitAuthors([
        makeAuthor(BigInt(10), 'ada-old'),
        makeAuthor(BigInt(10), 'ada'),
        makeAuthor(BigInt(11), 'grace'),
      ]);

      expect(values).toHaveLength(2);
      // Last occurrence wins, so a rename seen later in the page lands.
      expect(values[0].login).toBe('ada');
      expect(values[1].login).toBe('grace');
    });

    it('does not issue a statement for an empty page', async () => {
      const insertInto = jest.fn();
      const repo = new CollaboratorsRepository({ insertInto } as never);

      await repo.upsertManyFromCommitAuthors([]);

      expect(insertInto).not.toHaveBeenCalled();
    });
  });

  describe('listByOrganization', () => {
    it('returns the collaborator rows', async () => {
      const rows = [
        {
          id: 'c1',
          githubUserId: BigInt(10),
          login: 'ada',
          nodeId: null,
          avatarUrl: null,
          htmlUrl: null,
          type: 'User',
          siteAdmin: false,
          raw: {},
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      ];
      const chain: any = {
        innerJoin: () => chain,
        selectAll: () => chain,
        where: () => chain,
        orderBy: () => chain,
        execute: () => Promise.resolve(rows),
      };
      const fakeDb = { selectFrom: () => chain };
      const repo = new CollaboratorsRepository(fakeDb as never);
      const result = await repo.listByOrganization('org-1');
      expect(result).toHaveLength(1);
      expect(result[0].login).toBe('ada');
    });
  });
});
