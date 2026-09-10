import { Octokit } from '@octokit/core';
import { GithubAppClient } from '../github.client';

/**
 * The public surface of SOURCE's `github-app.client.ts`, checked in. The whole
 * point of the PAT port was that no caller changed — this list is what proves
 * it. Removing or renaming an entry is a caller-visible break, not a refactor.
 */
const SOURCE_METHODS = [
  'getInstallation',
  'listInstallationRepos',
  'deleteInstallation',
  'listCommits',
  'getCommit',
  'listCommitLocStats',
  'listRepoCollaborators',
  'getDefaultBranch',
  'listBranches',
  'getLatestCommitDate',
];

/** Private helpers the port added — anything else new is a surface change. */
const PRIVATE_METHODS = ['kit', 'retainGranted'];

const kit = () =>
  Octokit as unknown as { request: jest.Mock; iterator: jest.Mock };

function makeClient(token = 'github_pat_x') {
  return new GithubAppClient(() => Promise.resolve(token));
}

function pages(...batches: unknown[][]) {
  return () => ({
    async *[Symbol.asyncIterator]() {
      for (const data of batches) yield { data };
    },
  });
}

/**
 * The paging *failure* cases: an iterable whose first pull rejects. Written
 * as an iterator rather than `async *` with a bare `throw`, which is a
 * generator that never yields — a lint error. `for await` sees the same
 * failure either way.
 */
function failingPages(err: Error) {
  return () => ({
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(err) }),
  });
}

describe('GithubAppClient', () => {
  beforeEach(() => {
    (Octokit as unknown as { __reset: () => void }).__reset();
  });

  describe('method surface', () => {
    it('exposes exactly the methods SOURCE exposed', () => {
      const own = Object.getOwnPropertyNames(GithubAppClient.prototype).filter(
        (name) => name !== 'constructor',
      );

      expect(own.sort()).toEqual(
        [...SOURCE_METHODS, ...PRIVATE_METHODS].sort(),
      );
    });

    it('keeps every SOURCE method callable on an instance', () => {
      const client = makeClient() as unknown as Record<string, unknown>;
      for (const name of SOURCE_METHODS) {
        expect(typeof client[name]).toBe('function');
      }
    });
  });

  it('authenticates with the resolved token', async () => {
    const client = makeClient('github_pat_abc');
    kit().request.mockResolvedValue({ data: { id: 1, login: 'a' } });

    await client.getInstallation(7n);

    expect((Octokit as unknown as { __auths: unknown[] }).__auths).toEqual([
      'github_pat_abc',
    ]);
  });

  it('re-authenticates when the stored token is rotated', async () => {
    let token = 'old';
    const client = new GithubAppClient(() => Promise.resolve(token));
    kit().request.mockResolvedValue({ data: { id: 1, login: 'a' } });

    await client.getInstallation(7n);
    await client.getInstallation(7n);
    token = 'new';
    await client.getInstallation(7n);

    // Second call reused the cached client; the rotation built a new one.
    expect((Octokit as unknown as { __auths: unknown[] }).__auths).toEqual([
      'old',
      'new',
    ]);
  });

  it('describes the PAT account as the installation', async () => {
    const client = makeClient();
    kit().request.mockResolvedValue({
      data: {
        id: 99,
        login: 'acme',
        type: 'User',
        avatar_url: 'http://a',
      },
    });

    const meta = await client.getInstallation(0n);

    expect(kit().request).toHaveBeenCalledWith('GET /user');
    expect(meta).toMatchObject({
      githubInstallationId: '99',
      githubAccountId: '99',
      accountLogin: 'acme',
      accountType: 'User',
      targetType: 'User',
      suspendedAt: null,
    });
    expect(meta.raw).toMatchObject({ id: 99, login: 'acme' });
  });

  it('lists the repos the token can see, paginated', async () => {
    const client = makeClient();
    kit().iterator.mockImplementation(
      pages(
        [
          {
            id: 10,
            name: 'a',
            full_name: 'org/a',
            private: true,
            html_url: 'https://github.com/org/a',
          },
        ],
        [{ id: 11, name: 'b', full_name: 'org/b', private: false }],
      ),
    );

    const repos = await client.listInstallationRepos(123n);

    expect(kit().iterator).toHaveBeenCalledWith(
      'GET /user/repos',
      expect.objectContaining({ per_page: 100 }),
    );
    expect(repos).toHaveLength(2);
    expect(repos[0]).toMatchObject({ githubRepoId: '10', name: 'a' });
    expect(repos[0].raw).toMatchObject({
      id: 10,
      html_url: 'https://github.com/org/a',
    });
    expect(repos[1].raw).toMatchObject({ id: 11, full_name: 'org/b' });
  });

  describe('grant filtering', () => {
    /**
     * The bug this covers: `GET /user/repos` lists every public repository the
     * *account* is affiliated with, so a PAT scoped to one repo still returned
     * dozens. Only a `metadata=read`-gated probe tells the two apart.
     */
    const twoPublicOnePrivate = () =>
      kit().iterator.mockImplementation(
        pages([
          { id: 10, name: 'granted', full_name: 'org/granted', private: false },
          {
            id: 11,
            name: 'implicit',
            full_name: 'org/implicit',
            private: false,
          },
          { id: 12, name: 'secret', full_name: 'org/secret', private: true },
        ]),
      );

    const probeReplies = (replies: Record<string, 'ok' | number>) =>
      kit().request.mockImplementation(
        (_route: string, params: { repo: string }) => {
          const verdict = replies[params.repo];
          if (verdict === 'ok') return Promise.resolve({ data: [] });
          return Promise.reject(
            Object.assign(new Error('nope'), {
              status: verdict,
              response: { headers: { 'x-ratelimit-remaining': '4999' } },
            }),
          );
        },
      );

    it('drops public repos the token has no metadata grant on', async () => {
      const client = makeClient();
      twoPublicOnePrivate();
      probeReplies({ granted: 'ok', implicit: 403 });

      const repos = await client.listInstallationRepos(1n);

      expect(repos.map((r) => r.fullName)).toEqual([
        'org/granted',
        'org/secret',
      ]);
    });

    it('never probes a private repo — visibility already proves the grant', async () => {
      const client = makeClient();
      twoPublicOnePrivate();
      probeReplies({ granted: 403, implicit: 403 });

      const repos = await client.listInstallationRepos(1n);

      expect(repos.map((r) => r.fullName)).toEqual(['org/secret']);
      const probed = kit().request.mock.calls.map(
        (c: unknown[]) => (c[1] as { repo: string }).repo,
      );
      expect(probed).not.toContain('secret');
    });

    it('keeps the list unfiltered when a rate limit interrupts probing', async () => {
      const client = makeClient();
      twoPublicOnePrivate();
      kit().request.mockImplementation(() =>
        Promise.reject(
          Object.assign(new Error('API rate limit exceeded'), {
            status: 403,
            response: { headers: { 'x-ratelimit-remaining': '0' } },
          }),
        ),
      );

      const repos = await client.listInstallationRepos(1n);

      // Failing open is the safer wrong answer: an empty list reconciles the
      // user's repositories — and their commits and briefs — away.
      expect(repos).toHaveLength(3);
    });
  });

  it('wraps API errors as GITHUB_API_FAILED', async () => {
    const client = makeClient();
    kit().iterator.mockImplementation(failingPages(new Error('boom')));

    await expect(client.listInstallationRepos(1n)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('does not call GitHub to delete an installation', async () => {
    const client = makeClient();
    await expect(client.deleteInstallation(555n)).resolves.toBeUndefined();
    expect(kit().request).not.toHaveBeenCalled();
  });

  it('hands each commit page to the callback as it arrives', async () => {
    const client = makeClient();
    const rawCommit = (sha: string) => ({
      sha,
      parents: [{ sha: 'p1' }],
      commit: {
        author: { name: 'A', email: 'a@x', date: '2026-05-01T00:00:00Z' },
        committer: { name: 'C', email: 'c@x', date: '2026-05-01T00:00:01Z' },
        message: `msg-${sha}`,
      },
      author: { id: 1, login: 'a' },
      committer: { id: 2, login: 'c' },
    });
    kit().iterator.mockImplementation(
      pages([rawCommit('abc')], [rawCommit('def')]),
    );

    const seen: string[][] = [];
    await client.listCommits(
      9n,
      'acme/api',
      '2026-04-01T00:00:00Z',
      'main',
      async (page) => {
        seen.push(page.map((c) => c.sha));
      },
    );

    // One call per page, never one call with everything — the whole point.
    expect(seen).toEqual([['abc'], ['def']]);
    expect(kit().iterator).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/commits',
      expect.objectContaining({
        owner: 'acme',
        repo: 'api',
        sha: 'main',
        since: '2026-04-01T00:00:00Z',
      }),
    );
  });

  it('maps a raw commit page onto the list item shape', async () => {
    const client = makeClient();
    kit().iterator.mockImplementation(
      pages([
        {
          sha: 'abc',
          parents: [{ sha: 'p1' }],
          commit: {
            author: { name: 'A', email: 'a@x', date: '2026-05-01T00:00:00Z' },
            committer: {
              name: 'C',
              email: 'c@x',
              date: '2026-05-01T00:00:01Z',
            },
            message: 'first',
          },
          author: { id: 1, login: 'a' },
          committer: { id: 2, login: 'c' },
        },
      ]),
    );

    const seen: unknown[] = [];
    await client.listCommits(
      9n,
      'acme/api',
      '2026-04-01T00:00:00Z',
      'main',
      async (page) => {
        seen.push(...page);
      },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      sha: 'abc',
      parentCount: 1,
      authorGithubLogin: 'a',
      committerName: 'C',
    });
  });

  it('does not relabel a page-write failure as a GitHub failure', async () => {
    const client = makeClient();
    kit().iterator.mockImplementation(pages([]));

    await expect(
      client.listCommits(9n, 'acme/api', '2026-04-01T00:00:00Z', 'main', () =>
        Promise.reject(new Error('db down')),
      ),
    ).rejects.toThrow('db down');
  });

  it('paginates collaborators', async () => {
    const client = makeClient();
    kit().iterator.mockImplementation(
      pages(
        [
          {
            id: 1,
            login: 'alice',
            type: 'User',
            role_name: 'admin',
            permissions: {
              admin: true,
              maintain: true,
              push: true,
              triage: true,
              pull: true,
            },
          },
        ],
        [
          {
            id: 2,
            login: 'bot',
            type: 'Bot',
            role_name: 'read',
            permissions: {
              admin: false,
              maintain: false,
              push: false,
              triage: false,
              pull: true,
            },
          },
        ],
      ),
    );

    const collabs = await client.listRepoCollaborators(9n, 'acme', 'api');

    expect(collabs).toHaveLength(2);
    expect(collabs[0]).toMatchObject({
      id: 1,
      login: 'alice',
      role_name: 'admin',
    });
    expect(collabs[1]).toMatchObject({ id: 2, login: 'bot', type: 'Bot' });
    expect(kit().iterator).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/collaborators',
      expect.objectContaining({
        owner: 'acme',
        repo: 'api',
        affiliation: 'all',
        per_page: 100,
      }),
    );
  });

  it('rethrows 403/404 from collaborators untouched', async () => {
    const client = makeClient();
    const err = Object.assign(new Error('nope'), { status: 404 });
    kit().iterator.mockImplementation(failingPages(err));

    await expect(client.listRepoCollaborators(9n, 'acme', 'api')).rejects.toBe(
      err,
    );
  });

  it('fetches a single commit with file patches', async () => {
    const client = makeClient();
    kit().request.mockResolvedValue({
      data: {
        sha: 'abc',
        parents: [{ sha: 'p1' }],
        commit: {
          author: { name: 'A', email: 'a@x', date: '2026-05-01T00:00:00Z' },
          committer: { name: 'A', email: 'a@x', date: '2026-05-01T00:00:00Z' },
          message: 'm',
        },
        author: { id: 1, login: 'a' },
        committer: { id: 1, login: 'a' },
        files: [
          {
            filename: 'src/a.ts',
            status: 'modified',
            additions: 3,
            deletions: 1,
            changes: 4,
            patch: '@@ patch @@',
          },
        ],
      },
    });

    const detail = await client.getCommit(9n, 'acme/api', 'abc');
    expect(detail.files).toEqual([
      { path: 'src/a.ts', additions: 3, deletions: 1, patch: '@@ patch @@' },
    ]);
  });

  it('returns a page of LOC stats from GraphQL', async () => {
    const client = makeClient();
    kit().request.mockResolvedValue({
      data: {
        data: {
          repository: {
            defaultBranchRef: {
              target: {
                history: {
                  pageInfo: { hasNextPage: true, endCursor: 'cur-1' },
                  nodes: [{ oid: 'abc', additions: 3, deletions: 1 }],
                },
              },
            },
          },
        },
      },
    });

    const page = await client.listCommitLocStats(
      9n,
      'acme/api',
      '2026-04-01T00:00:00Z',
      null,
    );

    expect(page).toEqual({
      stats: [{ sha: 'abc', additions: 3, deletions: 1 }],
      nextCursor: 'cur-1',
    });
    expect(kit().request).toHaveBeenCalledWith(
      'POST /graphql',
      expect.objectContaining({
        variables: {
          owner: 'acme',
          name: 'api',
          since: '2026-04-01T00:00:00Z',
          cursor: null,
        },
      }),
    );
  });

  it('returns the latest commit date (committer date) from the branch head', async () => {
    const client = makeClient();
    kit().request.mockResolvedValue({
      data: [
        {
          sha: 'head',
          parents: [],
          commit: {
            author: { name: 'A', email: 'a@x', date: '2026-05-01T00:00:00Z' },
            committer: {
              name: 'C',
              email: 'c@x',
              date: '2026-05-02T00:00:00Z',
            },
            message: 'latest',
          },
          author: { id: 1, login: 'a' },
          committer: { id: 2, login: 'c' },
        },
      ],
    });

    const date = await client.getLatestCommitDate(9n, 'acme/api', 'main');

    expect(date).toEqual(new Date('2026-05-02T00:00:00Z'));
    expect(kit().request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/commits',
      expect.objectContaining({
        owner: 'acme',
        repo: 'api',
        sha: 'main',
        per_page: 1,
      }),
    );
  });

  it('returns null when the branch has no commits', async () => {
    const client = makeClient();
    kit().request.mockResolvedValue({ data: [] });

    await expect(
      client.getLatestCommitDate(9n, 'acme/api', 'main'),
    ).resolves.toBeNull();
  });

  it('returns null for an empty repository (409 from GitHub)', async () => {
    const client = makeClient();
    kit().request.mockRejectedValue(
      Object.assign(new Error('Git Repository is empty.'), { status: 409 }),
    );

    await expect(
      client.getLatestCommitDate(9n, 'acme/api', 'main'),
    ).resolves.toBeNull();
  });

  it('lists branches newest-first, flags the default, and reports truncation', async () => {
    const client = makeClient();
    const page = (
      nodes: Array<{ name: string; date: string | null }>,
      hasNextPage: boolean,
      endCursor: string | null,
    ) => ({
      data: {
        data: {
          repository: {
            defaultBranchRef: { name: 'develop' },
            refs: {
              pageInfo: { hasNextPage, endCursor },
              nodes: nodes.map((n) => ({
                name: n.name,
                target: n.date ? { committedDate: n.date } : null,
              })),
            },
          },
        },
      },
    });

    kit()
      .request.mockResolvedValueOnce(
        page(
          [
            { name: 'develop', date: '2026-08-12T09:14:00.000Z' },
            { name: 'main', date: null },
          ],
          true,
          'cur-1',
        ),
      )
      .mockResolvedValueOnce(
        page(
          [{ name: 'staging', date: '2026-08-01T00:00:00.000Z' }],
          true,
          'cur-2',
        ),
      )
      .mockResolvedValueOnce(
        page(
          [{ name: 'old', date: '2026-01-01T00:00:00.000Z' }],
          true,
          'cur-3',
        ),
      );

    const list = await client.listBranches(9n, 'acme/api');

    expect(list.defaultBranch).toBe('develop');
    expect(list.branches.map((b) => b.name)).toEqual([
      'develop',
      'main',
      'staging',
      'old',
    ]);
    expect(list.branches[0]).toMatchObject({
      isDefault: true,
      lastCommitAt: new Date('2026-08-12T09:14:00.000Z'),
    });
    expect(list.branches[1]).toMatchObject({
      isDefault: false,
      lastCommitAt: null,
    });
    // Page cap reached with more pages left — say so instead of silently
    // dropping the tail.
    expect(list.truncated).toBe(true);
    expect(kit().request).toHaveBeenCalledTimes(3);
    expect(kit().request).toHaveBeenLastCalledWith(
      'POST /graphql',
      expect.objectContaining({
        variables: { owner: 'acme', name: 'api', cursor: 'cur-2' },
      }),
    );
  });

  it('surfaces GraphQL errors from the branch query as GITHUB_API_FAILED', async () => {
    const client = makeClient();
    kit().request.mockResolvedValue({
      data: { errors: [{ message: 'Resource not accessible' }] },
    });

    await expect(client.listBranches(9n, 'acme/api')).rejects.toMatchObject({
      code: 'GITHUB_API_FAILED',
    });
  });

  it('reads the default branch', async () => {
    const client = makeClient();
    kit().request.mockResolvedValue({ data: { default_branch: 'trunk' } });

    await expect(client.getDefaultBranch(9n, 'acme/api')).resolves.toBe(
      'trunk',
    );
  });
});
