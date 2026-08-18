import { SlackInstallationsRepository } from '../repositories/installations.repository';

describe('SlackInstallationsRepository', () => {
  it('instantiates with a db handle and exposes all methods', () => {
    const repo = new SlackInstallationsRepository({} as never, {} as never);

    expect(typeof repo.findById).toBe('function');
    expect(typeof repo.findActiveByOrganizationId).toBe('function');
    expect(typeof repo.findByOrganizationIdIncludingDeleted).toBe('function');
    expect(typeof repo.findByIdScopedToOrg).toBe('function');
    expect(typeof repo.existsOtherActiveByTeamId).toBe('function');
    expect(typeof repo.create).toBe('function');
    expect(typeof repo.updateTokenAndRaw).toBe('function');
    expect(typeof repo.softDelete).toBe('function');
    expect(typeof repo.undelete).toBe('function');
  });
});

describe('SlackInstallationsRepository.existsOtherActiveByTeamId', () => {
  function makeDb(row: unknown) {
    const chain = {
      select: jest.fn(),
      where: jest.fn(),
      limit: jest.fn(),
      executeTakeFirst: jest.fn().mockResolvedValue(row),
    };
    chain.select.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    return { db: { selectFrom: jest.fn(() => chain) }, chain };
  }

  it('excludes the given row and only counts active installations', async () => {
    const { db, chain } = makeDb({ id: 'other-uuid' });
    const repo = new SlackInstallationsRepository(db as never, {} as never);

    expect(await repo.existsOtherActiveByTeamId('T1', 'inst-uuid')).toBe(true);
    expect(db.selectFrom).toHaveBeenCalledWith('slack.installations');
    expect(chain.where).toHaveBeenCalledWith('teamId', '=', 'T1');
    expect(chain.where).toHaveBeenCalledWith('id', '!=', 'inst-uuid');
    expect(chain.where).toHaveBeenCalledWith('deletedAt', 'is', null);
  });

  it('returns false when no other active installation matches', async () => {
    const { db } = makeDb(undefined);
    const repo = new SlackInstallationsRepository(db as never, {} as never);

    expect(await repo.existsOtherActiveByTeamId('T1', 'inst-uuid')).toBe(false);
  });
});
