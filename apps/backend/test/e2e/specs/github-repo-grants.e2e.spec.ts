import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';

/**
 * What the repository picker shows, end to end, for a fine-grained PAT.
 *
 * The bug this file exists for: `GET /user/repos` enumerates by *account
 * affiliation*, and a fine-grained PAT carries implicit read-only access to
 * every public repository — so a token scoped to one repository still lists
 * every public repo the account touches. Filtering the GitHub call was only
 * half a fix, because the picker does not read GitHub: it reads
 * `GET /api/integrations/github`, which serves stored `github.repositories`
 * rows. A token whose grants shrank has to *reconcile those rows away*, or the
 * user keeps seeing repositories their token cannot touch.
 */

const GITHUB_USER_ID = 5150;

/** Three public repos, as `GET /user/repos` returns them regardless of grant. */
const VISIBLE = [
  { id: 1, name: 'granted', full_name: 'octo/granted', private: false },
  { id: 2, name: 'affil-a', full_name: 'octo/affil-a', private: false },
  { id: 3, name: 'affil-b', full_name: 'octo/affil-b', private: false },
];

type Octo = {
  __reset: () => void;
  request: { mockImplementation: (fn: unknown) => void };
  iterator: { mockImplementation: (fn: unknown) => void };
};

function pages<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { data: items };
    },
  };
}

/**
 * `grantedRepos` is the set the PAT actually selected. Everything else answers
 * exactly as GitHub does for an ungranted public repo: readable, but 403 on the
 * `metadata=read`-gated `/collaborators`.
 */
function mockGitHub(octo: Octo, grantedRepos: string[]) {
  octo.__reset();

  octo.request.mockImplementation(
    (route: string, params: Record<string, unknown> = {}) => {
      if (route === 'GET /user') {
        return Promise.resolve({
          data: {
            id: GITHUB_USER_ID,
            login: 'octo',
            type: 'User',
            avatar_url: null,
          },
        });
      }
      if (route === 'GET /repos/{owner}/{repo}/collaborators') {
        if (grantedRepos.includes(String(params.repo))) {
          return Promise.resolve({ data: [] });
        }
        const err = Object.assign(
          new Error('Resource not accessible by personal access token'),
          {
            status: 403,
            // Quota intact — this is a permission 403, not a throttle.
            response: { headers: { 'x-ratelimit-remaining': '4321' } },
          },
        );
        return Promise.reject(err);
      }
      return Promise.resolve({ data: {} });
    },
  );

  octo.iterator.mockImplementation((route: string) => {
    if (route === 'GET /user/repos') return pages(VISIBLE);
    return pages([]);
  });
}

describe('repository discovery is the token grant set, not account affiliation', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let octo: Octo;

  const connect = (token: string) =>
    api(testApp.server).post('/api/integrations/github/token').send({ token });

  /** Exactly what the picker consumes. */
  const pickerRepos = async (): Promise<string[]> => {
    const res = await api(testApp.server).get('/api/integrations/github');
    const installations = (res.body.data ?? []) as {
      repositories: { fullName: string }[];
    }[];
    return installations.flatMap((i) => i.repositories.map((r) => r.fullName));
  };

  beforeAll(async () => {
    const created = await createTestDatabase();
    db = created.db;
    testApp = await createTestApp(db);
    octo = (await import('@octokit/core')).Octokit as unknown as Octo;
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(async () => {
    // Each case starts from no stored credential.
    await api(testApp.server).delete('/api/integrations/github');
  });

  it('stores only the granted repo, not the two reachable by implicit public read', async () => {
    mockGitHub(octo, ['granted']);

    await connect('github_pat_narrow').expect(201);

    expect(await pickerRepos()).toEqual(['octo/granted']);
  });

  it('reconciles stale rows away when the token grants less than before', async () => {
    // A broader token first: all three genuinely granted.
    mockGitHub(octo, ['granted', 'affil-a', 'affil-b']);
    await connect('github_pat_broad').expect(201);
    expect(await pickerRepos()).toHaveLength(3);

    // Re-paste after narrowing the token's Repository access to one repo.
    mockGitHub(octo, ['granted']);
    await connect('github_pat_narrow').expect(201);

    // The two the token can no longer touch must leave the picker. This is the
    // assertion that failed when only the GitHub call was filtered.
    expect(await pickerRepos()).toEqual(['octo/granted']);
  });

  it('empties the picker when the token grants nothing at all', async () => {
    mockGitHub(octo, ['granted']);
    await connect('github_pat_narrow').expect(201);
    expect(await pickerRepos()).toHaveLength(1);

    // The reported situation: a PAT whose selection never took effect, so every
    // repo is affiliation-only. Showing three phantom repositories is worse
    // than showing none.
    mockGitHub(octo, []);
    await connect('github_pat_grantless').expect(201);

    expect(await pickerRepos()).toEqual([]);
  });

  it('refuses a first-time connect that grants nothing, storing no credential', async () => {
    mockGitHub(octo, []);

    const res = await connect('github_pat_grantless');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('GITHUB_TOKEN_GRANTS_NO_REPOS');
    expect(await pickerRepos()).toEqual([]);
  });
});
