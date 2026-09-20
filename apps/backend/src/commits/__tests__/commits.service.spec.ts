import { CommitsService } from '../services/commits.service';
import type { CommitListRow } from '../repositories/commits-list.repository';

function row(over: Partial<CommitListRow> = {}): CommitListRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sha: 'abc1234def5678',
    authoredAt: new Date('2026-09-19T10:00:00.000Z'),
    authorName: 'Ada',
    authorLogin: 'ada',
    message: 'first line\nsecond line',
    repositoryFullName: 'VirtualPirate/gitbrief',
    analysisStatus: 'analyzed',
    analysisCommitType: 'feature',
    analysisSummary: 'Adds a thing',
    analysisChanges: ['one'],
    ...over,
  };
}

function makeService(listMock: jest.Mock) {
  return new CommitsService({ list: listMock } as never);
}

describe('CommitsService.list', () => {
  it('round-trips the keyset cursor through encode and decode', async () => {
    const first = row({ id: 'id-1' });
    const second = row({
      id: 'id-2',
      authoredAt: new Date('2026-09-18T10:00:00.000Z'),
    });
    const listMock = jest.fn().mockResolvedValue([first, second]);
    const service = makeService(listMock);

    // limit 1 with 2 rows back => hasMore, so a cursor is issued for row 1.
    const page = await service.list('org1', { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();

    await service.list('org1', { limit: 1, cursor: page.nextCursor as string });

    expect(listMock.mock.calls[1][0]).toMatchObject({
      cursorId: 'id-1',
      cursorAuthoredAt: first.authoredAt,
    });
  });

  it('rejects a malformed cursor', async () => {
    const service = makeService(jest.fn().mockResolvedValue([]));
    await expect(
      service.list('org1', { limit: 50, cursor: '!!' }),
    ).rejects.toThrow();
  });

  it('passes the unclassified type and analyzedOnly straight through', async () => {
    const listMock = jest.fn().mockResolvedValue([]);
    const service = makeService(listMock);

    await service.list('org1', {
      limit: 50,
      commitType: 'unclassified',
      analyzedOnly: true,
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-21T00:00:00.000Z',
    });

    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org1',
        commitType: 'unclassified',
        analyzedOnly: true,
        from: new Date('2026-09-01T00:00:00.000Z'),
        // Exclusive: the midnight after the last day picked.
        to: new Date('2026-09-21T00:00:00.000Z'),
        limit: 51,
      }),
    );
  });

  it('maps a row to the brief-commit shape, dropping a non-analyzed analysis', async () => {
    const listMock = jest
      .fn()
      .mockResolvedValue([
        row({ analysisStatus: 'skipped_merge', analysisCommitType: null }),
      ]);
    const service = makeService(listMock);

    const page = await service.list('org1', { limit: 50 });

    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toMatchObject({
      commitId: '11111111-1111-4111-8111-111111111111',
      messageFirstLine: 'first line',
      githubUrl:
        'https://github.com/VirtualPirate/gitbrief/commit/abc1234def5678',
      analysis: null,
    });
  });
});
