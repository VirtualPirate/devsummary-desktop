import { App } from '@octokit/app';
import { GithubAppClient } from '../github-app.client';

function makeClient() {
  return new GithubAppClient({
    appId: '1',
    slug: 'gb',
    privateKey: 'pk',
    webhookSecret: 'w',
  });
}

async function latestApp(): Promise<any> {
  const getInstances = () =>
    (App as unknown as { __mockInstances: any[] }).__mockInstances;

  for (let attempt = 0; attempt < 10; attempt++) {
    const instances = getInstances();
    if (instances.length > 0) {
      return instances[instances.length - 1];
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Expected App mock instance to be created');
}

describe('GithubAppClient', () => {
  beforeEach(() => {
    (App as unknown as { __reset: () => void }).__reset();
  });

  it('lists installation repos via eachRepository iterator', async () => {
    const client = makeClient();
    const app = await latestApp();

    app.eachRepository.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          repository: {
            id: 10,
            name: 'a',
            full_name: 'org/a',
            private: true,
            html_url: 'https://github.com/org/a',
            description: 'first repo',
          },
        };
        yield {
          repository: {
            id: 11,
            name: 'b',
            full_name: 'org/b',
            private: false,
            html_url: 'https://github.com/org/b',
            description: null,
          },
        };
      },
    });

    const repos = await client.listInstallationRepos(123n);
    expect(app.eachRepository.iterator).toHaveBeenCalledWith({
      installationId: 123,
    });
    expect(repos).toHaveLength(2);
    expect(repos[0]).toMatchObject({ githubRepoId: '10', name: 'a' });
    expect(repos[0].raw).toMatchObject({
      id: 10,
      html_url: 'https://github.com/org/a',
      description: 'first repo',
    });
    expect(repos[1].raw).toMatchObject({ id: 11, full_name: 'org/b' });
  });

  it('returns installation metadata via app-level request', async () => {
    const client = makeClient();
    const app = await latestApp();

    app.octokit.request.mockResolvedValue({
      data: {
        id: 555,
        account: {
          id: 99,
          login: 'acme',
          type: 'Organization',
          avatar_url: 'http://a',
        },
        target_type: 'Organization',
        suspended_at: null,
      },
    });

    const meta = await client.getInstallation(555n);
    expect(app.octokit.request).toHaveBeenCalledWith(
      'GET /app/installations/{installation_id}',
      { installation_id: '555' },
    );
    expect(meta).toMatchObject({
      githubInstallationId: '555',
      accountLogin: 'acme',
      accountType: 'Organization',
      targetType: 'Organization',
    });
    expect(meta.raw).toMatchObject({
      id: 555,
      account: { id: 99, login: 'acme', type: 'Organization' },
      target_type: 'Organization',
    });
  });

  it('deletes an installation via app-level request', async () => {
    const client = makeClient();
    const app = await latestApp();
    app.octokit.request.mockResolvedValue({ data: undefined });

    await client.deleteInstallation(555n);

    expect(app.octokit.request).toHaveBeenCalledWith(
      'DELETE /app/installations/{installation_id}',
      { installation_id: '555' },
    );
  });

  it('wraps API errors as GITHUB_API_FAILED', async () => {
    const client = makeClient();
    const app = await latestApp();
    app.eachRepository.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        throw new Error('boom');
      },
    });

    await expect(client.listInstallationRepos(1n)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('hands each commit page to the callback as it arrives', async () => {
    const client = makeClient();
    const app = await latestApp();
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
    const installationOctokit = {
      request: jest.fn(),
      paginate: {
        iterator: jest.fn(() => ({
          async *[Symbol.asyncIterator]() {
            yield { data: [rawCommit('abc')] };
            yield { data: [rawCommit('def')] };
          },
        })),
      },
    };
    app.getInstallationOctokit.mockResolvedValue(installationOctokit);

    const pages: string[][] = [];
    await client.listCommits(
      9n,
      'acme/api',
      '2026-04-01T00:00:00Z',
      'main',
      async (page) => {
        pages.push(page.map((c) => c.sha));
      },
    );

    // One call per page, never one call with everything — the whole point.
    expect(pages).toEqual([['abc'], ['def']]);
    expect(installationOctokit.paginate.iterator).toHaveBeenCalledWith(
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
    const app = await latestApp();
    app.getInstallationOctokit.mockResolvedValue({
      request: jest.fn(),
      paginate: {
        iterator: jest.fn(() => ({
          async *[Symbol.asyncIterator]() {
            yield {
              data: [
                {
                  sha: 'abc',
                  parents: [{ sha: 'p1' }],
                  commit: {
                    author: {
                      name: 'A',
                      email: 'a@x',
                      date: '2026-05-01T00:00:00Z',
                    },
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
              ],
            };
          },
        })),
      },
    });

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
    const app = await latestApp();
    app.getInstallationOctokit.mockResolvedValue({
      request: jest.fn(),
      paginate: {
        iterator: jest.fn(() => ({
          async *[Symbol.asyncIterator]() {
            yield { data: [] };
          },
        })),
      },
    });

    await expect(
      client.listCommits(9n, 'acme/api', '2026-04-01T00:00:00Z', 'main', () =>
        Promise.reject(new Error('db down')),
      ),
    ).rejects.toThrow('db down');
  });

  it('paginates collaborators via installation octokit', async () => {
    const client = makeClient();
    const app = await latestApp();
    const installationOctokit = {
      request: jest.fn(),
      paginate: {
        iterator: jest.fn(() => ({
          async *[Symbol.asyncIterator]() {
            yield {
              data: [
                {
                  id: 1,
                  login: 'alice',
                  node_id: 'MDQ6VXNlcjE=',
                  avatar_url: 'https://avatars.example/alice',
                  html_url: 'https://github.com/alice',
                  type: 'User',
                  site_admin: false,
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
            };
            yield {
              data: [
                {
                  id: 2,
                  login: 'bot',
                  node_id: 'MDQ6VXNlcjI=',
                  avatar_url: null,
                  html_url: 'https://github.com/bot',
                  type: 'Bot',
                  site_admin: false,
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
            };
          },
        })),
      },
    };
    app.getInstallationOctokit.mockResolvedValue(installationOctokit);

    const collabs = await client.listRepoCollaborators(9n, 'acme', 'api');

    expect(collabs).toHaveLength(2);
    expect(collabs[0]).toMatchObject({
      id: 1,
      login: 'alice',
      role_name: 'admin',
    });
    expect(collabs[1]).toMatchObject({ id: 2, login: 'bot', type: 'Bot' });
    expect(installationOctokit.paginate.iterator).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/collaborators',
      expect.objectContaining({
        owner: 'acme',
        repo: 'api',
        affiliation: 'all',
        per_page: 100,
      }),
    );
  });

  it('fetches a single commit with file patches', async () => {
    const client = makeClient();
    const app = await latestApp();
    const installationOctokit = {
      request: jest.fn(async () => ({
        data: {
          sha: 'abc',
          parents: [{ sha: 'p1' }],
          commit: {
            author: { name: 'A', email: 'a@x', date: '2026-05-01T00:00:00Z' },
            committer: {
              name: 'A',
              email: 'a@x',
              date: '2026-05-01T00:00:00Z',
            },
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
      })),
      paginate: { iterator: jest.fn() },
    };
    app.getInstallationOctokit.mockResolvedValue(installationOctokit);

    const detail = await client.getCommit(9n, 'acme/api', 'abc');
    expect(detail.files).toEqual([
      { path: 'src/a.ts', additions: 3, deletions: 1, patch: '@@ patch @@' },
    ]);
  });

  it('returns the latest commit date (committer date) from the branch head', async () => {
    const client = makeClient();
    const app = await latestApp();
    const installationOctokit = {
      request: jest.fn(async () => ({
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
      })),
      paginate: { iterator: jest.fn() },
    };
    app.getInstallationOctokit.mockResolvedValue(installationOctokit);

    const date = await client.getLatestCommitDate(9n, 'acme/api', 'main');

    expect(date).toEqual(new Date('2026-05-02T00:00:00Z'));
    expect(installationOctokit.request).toHaveBeenCalledWith(
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
    const app = await latestApp();
    const installationOctokit = {
      request: jest.fn(async () => ({ data: [] })),
      paginate: { iterator: jest.fn() },
    };
    app.getInstallationOctokit.mockResolvedValue(installationOctokit);

    const date = await client.getLatestCommitDate(9n, 'acme/api', 'main');
    expect(date).toBeNull();
  });

  it('returns null for an empty repository (409 from GitHub)', async () => {
    const client = makeClient();
    const app = await latestApp();
    const err = Object.assign(new Error('Git Repository is empty.'), {
      status: 409,
    });
    const installationOctokit = {
      request: jest.fn(async () => {
        throw err;
      }),
      paginate: { iterator: jest.fn() },
    };
    app.getInstallationOctokit.mockResolvedValue(installationOctokit);

    const date = await client.getLatestCommitDate(9n, 'acme/api', 'main');
    expect(date).toBeNull();
  });

  it('lists branches newest-first, flags the default, and reports truncation', async () => {
    const client = makeClient();
    const app = await latestApp();
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

    const installationOctokit = {
      request: jest
        .fn()
        .mockResolvedValueOnce(
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
        ),
      paginate: { iterator: jest.fn() },
    };
    app.getInstallationOctokit.mockResolvedValue(installationOctokit);

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
    expect(installationOctokit.request).toHaveBeenCalledTimes(3);
    expect(installationOctokit.request).toHaveBeenLastCalledWith(
      'POST /graphql',
      expect.objectContaining({
        variables: { owner: 'acme', name: 'api', cursor: 'cur-2' },
      }),
    );
  });

  it('surfaces GraphQL errors from the branch query as GITHUB_API_FAILED', async () => {
    const client = makeClient();
    const app = await latestApp();
    const installationOctokit = {
      request: jest.fn(async () => ({
        data: { errors: [{ message: 'Resource not accessible' }] },
      })),
      paginate: { iterator: jest.fn() },
    };
    app.getInstallationOctokit.mockResolvedValue(installationOctokit);

    await expect(client.listBranches(9n, 'acme/api')).rejects.toMatchObject({
      code: 'GITHUB_API_FAILED',
    });
  });
});
