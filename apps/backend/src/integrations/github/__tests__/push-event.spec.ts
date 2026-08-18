import { parsePushEvent } from '../services/push-event';

const commit = (id: string, timestamp: string) => ({ id, timestamp });

describe('parsePushEvent', () => {
  it('reads branch, shas and the earliest timestamp', () => {
    const parsed = parsePushEvent({
      ref: 'refs/heads/feature/thing',
      commits: [
        commit('c2', '2026-08-14T11:00:00Z'),
        commit('c1', '2026-08-14T10:00:00Z'),
      ],
      head_commit: commit('c2', '2026-08-14T11:00:00Z'),
    });

    expect(parsed).toEqual({
      branch: 'feature/thing',
      shas: ['c2', 'c1'],
      headSha: 'c2',
      truncated: false,
      earliestPushedISO: '2026-08-14T10:00:00.000Z',
    });
  });

  it('includes a head commit missing from the commits array', () => {
    const parsed = parsePushEvent({
      ref: 'refs/heads/main',
      commits: [],
      head_commit: commit('head', '2026-08-14T10:00:00Z'),
    });

    expect(parsed?.shas).toEqual(['head']);
    expect(parsed?.headSha).toBe('head');
  });

  it('ignores tag pushes', () => {
    expect(
      parsePushEvent({
        ref: 'refs/tags/v1.0.0',
        commits: [commit('c1', '2026-08-14T10:00:00Z')],
      }),
    ).toBeNull();
  });

  it('ignores a branch deletion', () => {
    expect(
      parsePushEvent({
        ref: 'refs/heads/main',
        deleted: true,
        commits: [],
        head_commit: null,
      }),
    ).toBeNull();
  });

  it('ignores a push naming no commit', () => {
    expect(
      parsePushEvent({
        ref: 'refs/heads/main',
        commits: [],
        head_commit: null,
        after: 'abc',
      }),
    ).toBeNull();
  });

  it('marks the payload truncated when size exceeds the inlined commits', () => {
    const parsed = parsePushEvent({
      ref: 'refs/heads/main',
      size: 5,
      commits: [commit('c1', '2026-08-14T10:00:00Z')],
      head_commit: commit('c1', '2026-08-14T10:00:00Z'),
    });

    expect(parsed?.truncated).toBe(true);
  });

  it('marks the payload truncated at GitHub inline cap when size is absent', () => {
    const commits = Array.from({ length: 2048 }, (_, i) =>
      commit(`c${i}`, '2026-08-14T10:00:00Z'),
    );

    const parsed = parsePushEvent({
      ref: 'refs/heads/main',
      commits,
      head_commit: commits[2047],
    });

    expect(parsed?.truncated).toBe(true);
  });

  it('survives garbage entries rather than throwing', () => {
    const parsed = parsePushEvent({
      ref: 'refs/heads/main',
      commits: [null, 7, { id: 5 }, commit('c1', 'not-a-date')],
      head_commit: commit('c1', 'not-a-date'),
    });

    expect(parsed).toEqual({
      branch: 'main',
      shas: ['c1'],
      headSha: 'c1',
      truncated: false,
      earliestPushedISO: null,
    });
  });
});
