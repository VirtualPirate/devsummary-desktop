import { createRequire } from 'node:module';
import { Logger } from '@nestjs/common';
import { AppError } from '../../common/errors';

/**
 * GitHub answers a spent rate limit with 403 as well as a missing permission, so
 * anything that reads 403 as "not permitted" has to rule this out first —
 * otherwise a throttled minute looks like a revoked grant.
 */
export function isRateLimitedError(err: unknown): boolean {
  const headers = (
    err as { response?: { headers?: Record<string, string | undefined> } }
  )?.response?.headers;
  if (!headers) return false;
  return (
    headers['x-ratelimit-remaining'] === '0' ||
    headers['retry-after'] !== undefined
  );
}

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

/** The picker waits on these probes, so they run wide — GitHub allows 5k/hour. */
const GRANT_PROBE_CONCURRENCY = 8;

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
  private readonly logger = new Logger(GithubAppClient.name);

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

  /**
   * Every repository the PAT actually **grants**, which is what the user picks
   * from — not every repository `GET /user/repos` returns.
   *
   * Those are not the same set, and the gap is the whole reason this method is
   * more than one paginate call. `GET /user/repos` enumerates by *account
   * affiliation*, and a fine-grained PAT additionally carries implicit read-only
   * access to every **public** repository. So "Only select repositories" never
   * narrows the response: an account with 72 public repos gets all 72 back
   * whether it selected one of them or none of them, and the one repository it
   * did select can be missing entirely (a private repo the token was not granted
   * metadata on is invisible here). Handing that list to the picker offers 72
   * repositories the token cannot summarise and hides the one it can.
   *
   * GitHub exposes no endpoint that enumerates a fine-grained PAT's selected set
   * (`GET /installation/repositories` is installation-token-only), so the grant
   * is probed instead: `/collaborators` is gated on `metadata=read`, which a PAT
   * holds only for its selected repositories, and public read does not satisfy
   * it. A private repository needs no probe — appearing in `/user/repos` at all
   * already proves the grant.
   *
   * ponytail: two known ceilings.
   *
   * 1. The probe is one request per public repository, so discovery is O(public
   *    repos) — ~72 calls against a 5k/hour limit for the account this was
   *    measured on, but a four-figure account would feel it. Upgrade path is a
   *    grant set cached per token and invalidated on re-paste; not built because
   *    connect and manual sync are the only callers.
   * 2. `/collaborators` also wants **push** access for the authenticated user,
   *    so a public repository the user is only a *read-only* collaborator on
   *    probes 403 and is dropped even though the token grants it. That is the
   *    false negative to reach for first if a repository goes missing from the
   *    picker. It is accepted because DevSummary summarises the user's own work,
   *    where owner/push is the ordinary case, and because the alternative — no
   *    filter — hides the granted repository behind dozens of ungranted ones.
   *    Fixing it needs a probe gated on `metadata=read` but not on role, and no
   *    such REST endpoint exists today.
   */
  async listInstallationRepos(
    installationId: bigint,
  ): Promise<GithubRepoSummary[]> {
    let kit: OctokitLike;
    const visible: GithubRepoSummary[] = [];
    try {
      kit = await this.kit(installationId);
      for await (const page of kit.paginate.iterator('GET /user/repos', {
        affiliation: 'owner,collaborator,organization_member',
        sort: 'pushed',
        per_page: 100,
      })) {
        for (const repository of page.data as RawRepo[]) {
          visible.push({
            githubRepoId: repository.id.toString(),
            name: repository.name,
            fullName: repository.full_name,
            private: repository.private,
            raw: repository,
          });
        }
      }
    } catch (err) {
      throw AppError.GITHUB_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    let granted: GithubRepoSummary[];
    try {
      granted = await this.retainGranted(kit, visible);
    } catch (err) {
      if (!isRateLimitedError(err)) {
        throw AppError.GITHUB_API_FAILED({
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
      this.logger.warn(
        `repo discovery: rate limited mid-probe, keeping all ${visible.length} visible repositories unfiltered`,
      );
      return visible;
    }

    if (granted.length !== visible.length) {
      this.logger.log(
        `repo discovery: ${visible.length} visible, ${granted.length} granted (dropped ${visible.length - granted.length} reachable only by GitHub's implicit public read)`,
      );
    }
    return granted;
  }

  /**
   * Drops the public repositories the token has no `metadata=read` grant on.
   *
   * **Fails open on a rate limit.** A throttled 403 is indistinguishable from a
   * missing permission by status alone, and treating it as "no grant" would
   * quietly reconcile the user's repositories away — the unfiltered list is the
   * safer wrong answer, so the whole filter is abandoned rather than applied to
   * partial evidence.
   */
  private async retainGranted(
    kit: OctokitLike,
    visible: GithubRepoSummary[],
  ): Promise<GithubRepoSummary[]> {
    const verdicts = new Map<string, boolean>();
    // Only public repositories need a probe, so they alone fill the batches —
    // slicing `visible` would let private repos consume concurrency slots.
    const needProbe = visible.filter((repo) => !repo.private);

    for (let i = 0; i < needProbe.length; i += GRANT_PROBE_CONCURRENCY) {
      const batch = needProbe.slice(i, i + GRANT_PROBE_CONCURRENCY);
      const probed = await Promise.all(
        batch.map(async (repo) => {
          const [owner, name] = repo.fullName.split('/');
          try {
            await kit.request('GET /repos/{owner}/{repo}/collaborators', {
              owner,
              repo: name,
              per_page: 1,
            });
            return [repo.fullName, true] as const;
          } catch (err) {
            if (isRateLimitedError(err)) throw err;
            const status = (err as { status?: number })?.status;
            if (status === 403 || status === 404) {
              return [repo.fullName, false] as const;
            }
            throw err;
          }
        }),
      );
      for (const [fullName, ok] of probed) verdicts.set(fullName, ok);
    }

    return visible.filter(
      (repo) => repo.private || verdicts.get(repo.fullName),
    );
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
