import type { World, WorldCommit, WorldRepo } from './world';

/** Every Octokit route the app calls. Anything else is a bug, not a `{}`. */
export type GithubRoute =
  | 'GET /user'
  | 'GET /user/repos'
  | 'GET /repos/{owner}/{repo}'
  | 'GET /repos/{owner}/{repo}/commits'
  | 'GET /repos/{owner}/{repo}/commits/{ref}'
  | 'GET /repos/{owner}/{repo}/collaborators'
  | 'POST /graphql';

export interface GithubCall {
  route: string;
  params: Record<string, unknown>;
  /** `paginate.iterator` rather than `request`. */
  paginated: boolean;
}

export type GithubHandler = (
  params: Record<string, unknown>,
) => unknown | Promise<unknown>;

interface Failure {
  status: number;
  message: string;
  remaining: number;
}

export interface GithubFake {
  world: World;
  /** Every call, in order — the only place a paging assertion can look. */
  calls: GithubCall[];
  /** Override one route's answer until `reset()`. `null` restores the table. */
  on(route: GithubRoute, handler: GithubHandler | null): void;
  /** Reject the next `times` calls of a route with an Octokit-shaped error. */
  failNext(
    route: GithubRoute,
    status: number,
    message: string,
    times?: number,
  ): void;
  reset(): void;
}

/** Octokit throws `RequestError`, which the app reads as `err.status`. */
class FakeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const findRepo = (world: World, params: Record<string, unknown>) =>
  world.repositories.find(
    (r) => r.fullName === `${String(params.owner)}/${String(params.repo)}`,
  );

const rawCommit = (world: World, repo: WorldRepo, commit: WorldCommit) => {
  const iso = commit.at.toISOString();
  const person = {
    name: world.author.name,
    email: world.author.email,
    date: iso,
  };
  return {
    sha: commit.sha,
    parents: Array.from({ length: commit.parents }, (_, i) => ({
      sha: `${commit.sha}-p${i}`,
    })),
    commit: { author: person, committer: person, message: commit.message },
    author: { id: world.author.githubId, login: world.author.login },
    committer: { id: world.author.githubId, login: world.author.login },
    // `repo` is unused by the payload but keeps the signature honest about
    // which repository this commit belongs to.
    _repo: repo.fullName,
  };
};

const rawRepo = (repo: WorldRepo) => ({
  id: repo.githubId,
  name: repo.name,
  full_name: repo.fullName,
  private: repo.private,
  default_branch: repo.branch,
});

const collaboratorPayload = (world: World) =>
  world.collaborators.map((c) => ({
    id: c.githubId,
    login: c.login,
    name: c.name,
    type: 'User',
    role_name: 'write',
    permissions: {
      admin: false,
      maintain: false,
      push: true,
      triage: false,
      pull: true,
    },
  }));

/**
 * Sits on the static `Octokit.request` / `Octokit.paginate.iterator` mocks the
 * alias in `vitest.e2e.config.ts` already installs, and answers them out of the
 * world instead of making every spec hand-stub each call.
 */
export async function installGithub(world: World): Promise<GithubFake> {
  const { Octokit } = (await import('@octokit/core')) as unknown as {
    Octokit: {
      __reset: () => void;
      request: { mockImplementation: (fn: unknown) => void };
      iterator: { mockImplementation: (fn: unknown) => void };
    };
  };
  Octokit.__reset();

  const calls: GithubCall[] = [];
  const overrides = new Map<string, GithubHandler>();
  const failures = new Map<string, Failure>();

  const takeFailure = (route: string): Failure | null => {
    const failure = failures.get(route);
    if (!failure) return null;
    failure.remaining -= 1;
    if (failure.remaining <= 0) failures.delete(route);
    return failure;
  };

  const answer = (route: string, params: Record<string, unknown>): unknown => {
    switch (route) {
      case 'GET /user':
        return {
          id: world.accountId,
          login: world.accountLogin,
          type: 'User',
          avatar_url: null,
        };
      case 'GET /repos/{owner}/{repo}': {
        const repo = findRepo(world, params);
        if (!repo) throw new FakeRequestError('Not Found', 404);
        return rawRepo(repo);
      }
      case 'GET /repos/{owner}/{repo}/collaborators':
        return collaboratorPayload(world);
      // `request`, not the iterator: `getLatestCommitDate` asks for per_page 1.
      case 'GET /repos/{owner}/{repo}/commits': {
        const repo = findRepo(world, params);
        if (!repo) throw new FakeRequestError('Not Found', 404);
        const newest = [...repo.commits].sort(
          (a, b) => b.at.getTime() - a.at.getTime(),
        )[0];
        return newest ? [rawCommit(world, repo, newest)] : [];
      }
      case 'GET /repos/{owner}/{repo}/commits/{ref}': {
        const repo = findRepo(world, params);
        const commit = repo?.commits.find((c) => c.sha === params.ref);
        if (!repo || !commit) throw new FakeRequestError('Not Found', 404);
        return {
          ...rawCommit(world, repo, commit),
          files: [
            {
              filename: 'src/index.ts',
              status: 'modified',
              additions: 4,
              deletions: 1,
              changes: 5,
              patch: '@@ -1 +1 @@\n-old\n+new',
            },
          ],
        };
      }
      case 'POST /graphql': {
        const query = String(params.query ?? '');
        const variables = (params.variables ?? {}) as Record<string, unknown>;
        const repo = world.repositories.find(
          (r) =>
            r.fullName ===
            `${String(variables.owner)}/${String(variables.name)}`,
        );
        if (query.includes('CommitLocStats')) {
          return {
            data: {
              repository: {
                defaultBranchRef: {
                  target: {
                    history: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: (repo?.commits ?? []).map((c) => ({
                        oid: c.sha,
                        additions: 4,
                        deletions: 1,
                      })),
                    },
                  },
                },
              },
            },
          };
        }
        return {
          data: {
            repository: {
              defaultBranchRef: repo ? { name: repo.branch } : null,
              refs: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: repo
                  ? [
                      {
                        name: repo.branch,
                        target: {
                          committedDate: [...repo.commits]
                            .sort((a, b) => b.at.getTime() - a.at.getTime())[0]
                            ?.at.toISOString(),
                        },
                      },
                    ]
                  : [],
              },
            },
          },
        };
      }
      default:
        throw new Error(
          `github fake: no answer for route "${route}". Add it to the route table rather than letting it return an empty body.`,
        );
    }
  };

  const pages = (items: unknown[]) => ({
    async *[Symbol.asyncIterator]() {
      yield { data: items };
    },
  });

  Octokit.request.mockImplementation(
    async (route: string, params: Record<string, unknown> = {}) => {
      calls.push({ route, params, paginated: false });
      const failure = takeFailure(route);
      if (failure) {
        throw new FakeRequestError(failure.message, failure.status);
      }
      const override = overrides.get(route);
      const data = override ? await override(params) : answer(route, params);
      return { data };
    },
  );

  Octokit.iterator.mockImplementation(
    (route: string, params: Record<string, unknown> = {}) => {
      calls.push({ route, params, paginated: true });
      const failure = takeFailure(route);
      if (failure) {
        return {
          // eslint-disable-next-line require-yield
          async *[Symbol.asyncIterator]() {
            throw new FakeRequestError(failure.message, failure.status);
          },
        };
      }
      const override = overrides.get(route);
      if (override) {
        return {
          async *[Symbol.asyncIterator]() {
            yield { data: (await override(params)) as unknown[] };
          },
        };
      }
      switch (route) {
        case 'GET /user/repos':
          return pages(world.repositories.map(rawRepo));
        case 'GET /repos/{owner}/{repo}/commits': {
          const repo = findRepo(world, params);
          if (!repo) return pages([]);
          const since = params.since ? new Date(String(params.since)) : null;
          const commits = [...repo.commits]
            .filter((c) => !since || c.at >= since)
            .sort((a, b) => b.at.getTime() - a.at.getTime())
            .map((c) => rawCommit(world, repo, c));
          return pages(commits);
        }
        case 'GET /repos/{owner}/{repo}/collaborators':
          return pages(collaboratorPayload(world));
        default:
          throw new Error(
            `github fake: no paginated answer for route "${route}".`,
          );
      }
    },
  );

  return {
    world,
    calls,
    on: (route, handler) => {
      if (handler) overrides.set(route, handler);
      else overrides.delete(route);
    },
    failNext: (route, status, message, times = 1) => {
      failures.set(route, { status, message, remaining: times });
    },
    reset: () => {
      calls.length = 0;
      overrides.clear();
      failures.clear();
    },
  };
}
