import { createRequire } from 'node:module';
import { AppError } from '../../common/errors';

export interface GithubRepoSummary {
  githubRepoId: string;
  name: string;
  fullName: string;
  private: boolean;
  raw: unknown;
}

export interface GithubInstallationMeta {
  githubInstallationId: string;
  githubAccountId: string;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  accountAvatarUrl: string | null;
  targetType: string;
  suspendedAt: Date | null;
  raw: unknown;
}

type RawRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
};

/** `GET /user` — the PAT's own account. Stands in for the App installation. */
type RawUser = {
  id: number;
  login: string;
  type?: string | null;
  avatar_url?: string | null;
};

/**
 * The GitHub account attached to a commit. Same object `/collaborators`
 * returns, and the only App-visible source of it on a repository whose access
 * is inherited rather than granted directly (see `listRepoCollaborators`).
 */
export interface GithubUserRef {
  id: number;
  login: string;
  node_id?: string | null;
  avatar_url?: string | null;
  html_url?: string | null;
  type?: string | null;
  site_admin?: boolean;
}

type RawCommitListItem = {
  sha: string;
  parents: { sha: string }[];
  commit: {
    author: { name: string; email: string; date: string };
    committer: { name: string; email: string; date: string };
    message: string;
  };
  author: GithubUserRef | null;
  committer: GithubUserRef | null;
};

type RawCommitDetail = RawCommitListItem & {
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
  }>;
};

export interface GithubCommitListItem {
  sha: string;
  parentCount: number;
  message: string;
  authorGithubUserId: bigint | null;
  authorGithubLogin: string | null;
  authorName: string;
  authorEmail: string;
  /** Null when GitHub could not match the commit's author email to an account. */
  authorUser: GithubUserRef | null;
  committerGithubUserId: bigint | null;
  committerGithubLogin: string | null;
  committerName: string;
  committerEmail: string;
  authoredAt: Date;
  committedAt: Date;
  raw: unknown;
}

export interface GithubCommitFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface GithubCommitDetail extends GithubCommitListItem {
  files: GithubCommitFile[];
}

export interface CommitLocStat {
  sha: string;
  additions: number;
  deletions: number;
}

export interface CommitLocStatsPage {
  stats: CommitLocStat[];
  nextCursor: string | null;
}

export interface GithubBranchSummary {
  name: string;
  isDefault: boolean;
  lastCommitAt: Date | null;
}

export interface GithubBranchList {
  branches: GithubBranchSummary[];
  defaultBranch: string | null;
  truncated: boolean;
}

export interface RepoCollaborator {
  id: number;
  login: string;
  node_id?: string;
  avatar_url?: string | null;
  html_url?: string | null;
  type?: string | null;
  site_admin?: boolean;
  role_name: string;
  permissions: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
}

type OctokitLike = {
  request: (
    route: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown }>;
  paginate: {
    iterator: (
      route: string,
      params: Record<string, string | number>,
    ) => AsyncIterable<{ data: unknown[] }>;
  };
};

type OctokitConstructor = new (opts: { auth: string }) => OctokitLike;

/**
 * The PAT for a stored credential. Every caller already passes the
 * installation row's `githubInstallationId`, so the token is resolved from that
 * — no caller changed when the App became a pasted token.
 */
export type GithubTokenResolver = (installationId: bigint) => Promise<string>;

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  // `@octokit/*` is ESM-only and Jest runs CJS; the manual mocks in
  // `src/__mocks__/@octokit/` are wired through `moduleNameMapper`, which a
  // `createRequire` call inside Jest still honours.
  if (process.env.JEST_WORKER_ID) {
    const require = createRequire(__filename);
    const { Octokit } = require('@octokit/core') as {
      Octokit: { plugin: (p: unknown) => OctokitConstructor };
    };
    const { paginateRest } = require('@octokit/plugin-paginate-rest') as {
      paginateRest: unknown;
    };
    return Octokit.plugin(paginateRest);
  }

  const [coreMod, paginateMod] = await Promise.all([
    import('@octokit/core'),
    import('@octokit/plugin-paginate-rest'),
  ]);
  const { Octokit } = coreMod as unknown as {
    Octokit: { plugin: (p: unknown) => OctokitConstructor };
  };
  const { paginateRest } = paginateMod as unknown as { paginateRest: unknown };
  return Octokit.plugin(paginateRest);
}

/**
 * Same public surface as the GitHub App client it replaces — the ~15 call sites
 * in services, activities and collaborator sync are untouched. Only the
 * authentication changed: one user PAT instead of per-installation App tokens.
 *
 * The class name is deliberately unchanged: it is the DI token every consumer
 * injects.
 */
export class GithubAppClient {
  /** One credential per desktop install, so a single-entry cache is the pool. */
  private cached: { token: string; kit: OctokitLike } | null = null;

  constructor(private readonly resolveToken: GithubTokenResolver) {}

  private async kit(installationId: bigint): Promise<OctokitLike> {
    const token = await this.resolveToken(installationId);
    if (this.cached?.token !== token) {
      const Octokit = await loadOctokitConstructor();
      this.cached = { token, kit: new Octokit({ auth: token }) };
    }
    return this.cached.kit;
  }

  /**
   * The PAT's own account, shaped like the App installation it replaces.
   * `githubInstallationId` is the GitHub user id — the key the whole codebase
   * already carries around as "the installation".
   */
  async getInstallation(
    installationId: bigint,
  ): Promise<GithubInstallationMeta> {
    try {
      const kit = await this.kit(installationId);
      const { data } = await kit.request('GET /user');
      const raw = data as RawUser;
      const accountType = raw.type === 'Organization' ? 'Organization' : 'User';
      return {
        githubInstallationId: raw.id.toString(),
        githubAccountId: raw.id.toString(),
        accountLogin: raw.login,
        accountType,
        accountAvatarUrl: raw.avatar_url ?? null,
        targetType: accountType,
        suspendedAt: null,
        raw: data,
      };
    } catch (err) {
      throw AppError.GITHUB_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /** Every repository the PAT can see, which is what the user picks from. */
  async listInstallationRepos(
    installationId: bigint,
  ): Promise<GithubRepoSummary[]> {
    try {
      const kit = await this.kit(installationId);
      const out: GithubRepoSummary[] = [];
      for await (const page of kit.paginate.iterator('GET /user/repos', {
        affiliation: 'owner,collaborator,organization_member',
        sort: 'pushed',
        per_page: 100,
      })) {
        for (const repository of page.data as RawRepo[]) {
          out.push({
            githubRepoId: repository.id.toString(),
            name: repository.name,
            fullName: repository.full_name,
            private: repository.private,
            raw: repository,
          });
        }
      }
      return out;
    } catch (err) {
      throw AppError.GITHUB_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /**
   * No-op. A PAT is revoked by its owner on github.com — there is no API to
   * delete it, and nothing else about disconnecting is remote. Kept so
   * `disconnect` reads the same as it did under the App.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deleteInstallation(installationId: bigint): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Hands each page to `onPage` instead of returning the whole history: a year
   * of a busy repository is thousands of items each carrying a ~2 KB raw
   * payload, and accumulating them here held all of it in the worker heap
   * before a single row was written (`docs/scale-ceilings.md`).
   */
  async listCommits(
    installationId: bigint,
    repoFullName: string,
    sinceISO: string,
    sha: string,
    onPage: (commits: GithubCommitListItem[]) => Promise<void>,
  ): Promise<void> {
    const [owner, repo] = repoFullName.split('/');
    const fail = (err: unknown) =>
      AppError.GITHUB_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });

    let pages: AsyncIterator<{ data: unknown[] }>;
    try {
      const kit = await this.kit(installationId);
      pages = kit.paginate
        .iterator('GET /repos/{owner}/{repo}/commits', {
          owner,
          repo,
          sha,
          since: sinceISO,
          per_page: 100,
        })
        [Symbol.asyncIterator]();
    } catch (err) {
      throw fail(err);
    }

    for (;;) {
      let next: IteratorResult<{ data: unknown[] }>;
      try {
        next = await pages.next();
      } catch (err) {
        throw fail(err);
      }
      if (next.done) return;
      // Stepped by hand so this call sits *outside* the catch: whatever the
      // caller does with a page (write it) is not a GitHub failure and must not
      // be relabelled as one.
      await onPage(
        (next.value.data as RawCommitListItem[]).map(toCommitListItem),
      );
    }
  }

  async getCommit(
    installationId: bigint,
    repoFullName: string,
    sha: string,
  ): Promise<GithubCommitDetail> {
    const [owner, repo] = repoFullName.split('/');
    try {
      const kit = await this.kit(installationId);
      const { data } = await kit.request(
        'GET /repos/{owner}/{repo}/commits/{ref}',
        { owner, repo, ref: sha },
      );
      const raw = data as RawCommitDetail;
      return {
        ...toCommitListItem(raw),
        files: (raw.files ?? []).map((f) => ({
          path: f.filename,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
      };
    } catch (err) {
      throw AppError.GITHUB_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  private static readonly COMMIT_LOC_STATS_QUERY = `
    query CommitLocStats($owner: String!, $name: String!, $since: GitTimestamp!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 100, since: $since, after: $cursor) {
                pageInfo { hasNextPage endCursor }
                nodes { oid additions deletions }
              }
            }
          }
        }
      }
    }
  `;

  /** One page of default-branch commit history with per-commit line
   * stats — ~100 commits per request instead of one REST call each. */
  async listCommitLocStats(
    installationId: bigint,
    repoFullName: string,
    sinceISO: string,
    cursor: string | null,
  ): Promise<CommitLocStatsPage> {
    const [owner, name] = repoFullName.split('/');
    try {
      const kit = await this.kit(installationId);
      const { data } = await kit.request('POST /graphql', {
        query: GithubAppClient.COMMIT_LOC_STATS_QUERY,
        variables: { owner, name, since: sinceISO, cursor },
      });
      const body = data as {
        data?: {
          repository?: {
            defaultBranchRef?: {
              target?: {
                history?: {
                  pageInfo: { hasNextPage: boolean; endCursor: string | null };
                  nodes: Array<{
                    oid: string;
                    additions: number;
                    deletions: number;
                  }>;
                };
              } | null;
            } | null;
          } | null;
        };
        errors?: Array<{ message: string }>;
      };
      if (body.errors?.length) {
        throw new Error(body.errors.map((e) => e.message).join('; '));
      }
      const history = body.data?.repository?.defaultBranchRef?.target?.history;
      if (!history) return { stats: [], nextCursor: null };
      return {
        stats: history.nodes.map((n) => ({
          sha: n.oid,
          additions: n.additions,
          deletions: n.deletions,
        })),
        nextCursor: history.pageInfo.hasNextPage
          ? history.pageInfo.endCursor
          : null,
      };
    } catch (err) {
      throw AppError.GITHUB_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /**
   * Only the collaborators granted **directly** on this repository, which can
   * be far fewer than a human sees. Access inherited from a fork's parent is
   * still invisible here.
   *
   * So this is the access list and nothing more. Who a brief can be scoped to
   * comes from commit authorship — see
   * `CollaboratorsRepository.upsertManyFromCommitAuthors`.
   */
  async listRepoCollaborators(
    installationId: bigint,
    owner: string,
    repo: string,
  ): Promise<RepoCollaborator[]> {
    try {
      const kit = await this.kit(installationId);
      const out: RepoCollaborator[] = [];
      for await (const page of kit.paginate.iterator(
        'GET /repos/{owner}/{repo}/collaborators',
        { owner, repo, affiliation: 'all', per_page: 100 },
      )) {
        for (const row of page.data as RepoCollaborator[]) {
          out.push(row);
        }
      }
      return out;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404 || status === 403) {
        throw err;
      }
      throw AppError.GITHUB_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  async getDefaultBranch(
    installationId: bigint,
    repoFullName: string,
  ): Promise<string> {
    const [owner, repo] = repoFullName.split('/');
    try {
      const kit = await this.kit(installationId);
      const { data } = await kit.request('GET /repos/{owner}/{repo}', {
        owner,
        repo,
      });
      const branch = (data as { default_branch?: string }).default_branch;
      if (!branch) throw new Error('default_branch missing');
      return branch;
    } catch (err) {
      throw AppError.GITHUB_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  private static readonly REPO_BRANCHES_QUERY = `
    query RepoBranches($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef { name }
        refs(refPrefix: "refs/heads/", first: 100, after: $cursor, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
          pageInfo { hasNextPage endCursor }
          nodes {
            name
            target { ... on Commit { committedDate } }
          }
        }
      }
    }
  `;

  /**
   * Branch list for the picker, newest-committed first, with the default branch
   * flagged.
   *
   * GraphQL rather than `GET /repos/{owner}/{repo}/branches` because the REST
   * list carries no commit date and no ordering — sorting by last commit would
   * cost one extra call per branch, and a repo with 200 renovate branches is
   * unusable unsorted. `TAG_COMMIT_DATE` orders refs by their target commit
   * date, which is what "recently active branch" means here.
   *
   * Capped at `MAX_BRANCH_PAGES` pages; `truncated` says so rather than
   * pretending the tail doesn't exist. Since the list is ordered by activity,
   * anything cut off is the stalest.
   */
  async listBranches(
    installationId: bigint,
    repoFullName: string,
  ): Promise<GithubBranchList> {
    const MAX_BRANCH_PAGES = 3;
    const [owner, name] = repoFullName.split('/');
    try {
      const kit = await this.kit(installationId);

      const branches: GithubBranchSummary[] = [];
      let defaultBranch: string | null = null;
      let cursor: string | null = null;
      let truncated = false;

      for (let page = 0; page < MAX_BRANCH_PAGES; page += 1) {
        const { data } = await kit.request('POST /graphql', {
          query: GithubAppClient.REPO_BRANCHES_QUERY,
          variables: { owner, name, cursor },
        });
        const body = data as {
          data?: {
            repository?: {
              defaultBranchRef?: { name?: string } | null;
              refs?: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: Array<{
                  name: string;
                  target?: { committedDate?: string } | null;
                }>;
              } | null;
            } | null;
          };
          errors?: Array<{ message: string }>;
        };
        if (body.errors?.length) {
          throw new Error(body.errors.map((e) => e.message).join('; '));
        }

        const repository = body.data?.repository;
        defaultBranch = repository?.defaultBranchRef?.name ?? defaultBranch;
        const refs = repository?.refs;
        if (!refs) break;

        for (const node of refs.nodes) {
          branches.push({
            name: node.name,
            isDefault: false,
            lastCommitAt: node.target?.committedDate
              ? new Date(node.target.committedDate)
              : null,
          });
        }

        if (!refs.pageInfo.hasNextPage) {
          cursor = null;
          break;
        }
        cursor = refs.pageInfo.endCursor;
        truncated = page === MAX_BRANCH_PAGES - 1;
      }

      // Flagged after collection, not during: the default branch can sit on any
      // page, and an empty repository has a defaultBranchRef of null with no
      // matching ref at all.
      for (const branch of branches) {
        branch.isDefault = branch.name === defaultBranch;
      }

      return { branches, defaultBranch, truncated };
    } catch (err) {
      throw AppError.GITHUB_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  async getLatestCommitDate(
    installationId: bigint,
    repoFullName: string,
    branch: string,
  ): Promise<Date | null> {
    const [owner, repo] = repoFullName.split('/');
    try {
      const kit = await this.kit(installationId);
      const { data } = await kit.request('GET /repos/{owner}/{repo}/commits', {
        owner,
        repo,
        sha: branch,
        per_page: 1,
      });
      const list = data as RawCommitListItem[];
      if (!list || list.length === 0) return null;
      return new Date(list[0].commit.committer.date);
    } catch (err) {
      // GitHub returns 409 for an empty repository's commits endpoint.
      if ((err as { status?: number })?.status === 409) return null;
      throw AppError.GITHUB_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
}

function toCommitListItem(raw: RawCommitListItem): GithubCommitListItem {
  return {
    sha: raw.sha,
    parentCount: raw.parents.length,
    message: raw.commit.message,
    authorGithubUserId: raw.author ? BigInt(raw.author.id) : null,
    authorGithubLogin: raw.author?.login ?? null,
    authorName: raw.commit.author.name,
    authorEmail: raw.commit.author.email,
    authorUser: raw.author,
    committerGithubUserId: raw.committer ? BigInt(raw.committer.id) : null,
    committerGithubLogin: raw.committer?.login ?? null,
    committerName: raw.commit.committer.name,
    committerEmail: raw.commit.committer.email,
    authoredAt: new Date(raw.commit.author.date),
    committedAt: new Date(raw.commit.committer.date),
    raw,
  };
}
