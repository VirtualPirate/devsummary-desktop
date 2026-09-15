import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { api } from '../harness/api';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { createTestDatabase } from '../harness/database';
import { waitForJobs } from '../harness/wait-for-jobs';

/**
 * The whole product, in one process, against the mocks D-E approves:
 * paste a PAT → repositories reconciled → pick a branch → the live job runner
 * scans, backfills and analyses → a project scope → a brief generated and
 * delivered to Slack.
 *
 * This is the spec PHASE-11 concern 3 says did not exist. Every earlier e2e
 * file exercises one controller; this one exercises the seams *between* them —
 * the job runner, the enqueue ids, the write-once branch rule and the two
 * OpenAI callers sharing one mocked SDK.
 *
 * Nothing is stubbed at the DI layer. `vitest.e2e.config.ts` aliases
 * `@octokit/*`, `openai` and `@slack/web-api` to the unit suites' own mocks,
 * so the app's client wiring, its token resolution and its retry profiles are
 * all under test; only the sockets are not real.
 */

const GITHUB_USER_ID = 4242;
const GITHUB_REPO_ID = 900123;
const REPO_FULL_NAME = 'octo-e2e/api';
const BRANCH = 'main';

const day = 24 * 60 * 60 * 1000;
/** Recent, so the default 7-day on-demand brief window covers them. */
const COMMIT_TIMES = [
  new Date(Date.now() - 3 * day),
  new Date(Date.now() - 2 * day),
];

type RawCommit = ReturnType<typeof rawCommit>;

function rawCommit(sha: string, at: Date, parents: number) {
  const iso = at.toISOString();
  return {
    sha,
    parents: Array.from({ length: parents }, (_, i) => ({ sha: `p${i}` })),
    commit: {
      author: { name: 'Ada', email: 'ada@example.com', date: iso },
      committer: { name: 'Ada', email: 'ada@example.com', date: iso },
      message: `feat: ${sha}`,
    },
    author: { id: 77, login: 'ada' },
    committer: { id: 77, login: 'ada' },
  };
}

/** Newest first, the order GitHub's commits list returns. */
const COMMITS: RawCommit[] = [
  rawCommit('sha-newer', COMMIT_TIMES[1], 1),
  rawCommit('sha-older', COMMIT_TIMES[0], 1),
];

function pages<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { data: items };
    },
  };
}

describe('full pipeline: connect → ingest → analyze → brief → deliver', () => {
  let db: Kysely<Database>;
  let testApp: TestApp;
  let repositoryId: string;
  let projectId: string;
  let briefId: string;

  beforeAll(async () => {
    // Set before the app is built: `SecretsService` reads env in its
    // constructor, and the OpenAI configs read it live through ConfigService.
    process.env.OPENAI_API_KEY = 'sk-e2e';

    const { Octokit } = (await import('@octokit/core')) as unknown as {
      Octokit: {
        __reset: () => void;
        request: { mockImplementation: (fn: unknown) => void };
        iterator: { mockImplementation: (fn: unknown) => void };
      };
    };
    Octokit.__reset();

    Octokit.request.mockImplementation(
      (route: string, params: Record<string, unknown> = {}) => {
        switch (route) {
          // `getInstallation` — the PAT's own account stands in for the App
          // installation the row is still keyed on.
          case 'GET /user':
            return Promise.resolve({
              data: {
                id: GITHUB_USER_ID,
                login: 'octo-e2e',
                type: 'User',
                avatar_url: null,
              },
            });
          // `getLatestCommitDate` — per_page 1, and the anchor the lookback
          // window is measured back from.
          case 'GET /repos/{owner}/{repo}/commits':
            return Promise.resolve({ data: [COMMITS[0]] });
          // `getCommit` — the diff the analyzer sends to OpenAI.
          case 'GET /repos/{owner}/{repo}/commits/{ref}': {
            const found = COMMITS.find((c) => c.sha === params.ref);
            if (!found)
              return Promise.reject(
                new Error(`no commit ${String(params.ref)}`),
              );
            return Promise.resolve({
              data: {
                ...found,
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
              },
            });
          }
          // `listBranches` is the only GraphQL caller reached here.
          case 'POST /graphql':
            return Promise.resolve({
              data: {
                data: {
                  repository: {
                    defaultBranchRef: { name: BRANCH },
                    refs: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [
                        {
                          name: BRANCH,
                          target: {
                            committedDate: COMMITS[0].commit.committer.date,
                          },
                        },
                      ],
                    },
                  },
                },
              },
            });
          default:
            return Promise.resolve({ data: {} });
        }
      },
    );

    Octokit.iterator.mockImplementation((route: string) => {
      if (route === 'GET /user/repos') {
        return pages([
          {
            id: GITHUB_REPO_ID,
            name: 'api',
            full_name: REPO_FULL_NAME,
            private: false,
          },
        ]);
      }
      if (route === 'GET /repos/{owner}/{repo}/commits') return pages(COMMITS);
      // Collaborator sync runs on connect; direct grants are empty here, which
      // is the ordinary case for a personal token.
      return pages([]);
    });

    ({ db } = await createTestDatabase());
    testApp = await createTestApp(db);
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('connects a pasted PAT and reconciles the repositories it can see', async () => {
    const res = await api(testApp.server)
      .post('/api/integrations/github/token')
      .send({ token: 'github_pat_e2e' })
      .expect(201);

    expect(res.body.data.accountLogin).toBe('octo-e2e');
    expect(res.body.data.repositories).toHaveLength(1);
    expect(res.body.data.repositories[0].fullName).toBe(REPO_FULL_NAME);
    // Inert until a branch is chosen — invariant §4.4.
    expect(res.body.data.repositories[0].branch).toBeNull();

    repositoryId = res.body.data.repositories[0].id as string;
  });

  it('reports github: true from GET /api/local-settings after connecting', async () => {
    const res = await api(testApp.server)
      .get('/api/local-settings')
      .expect(200);
    // The fix for PHASE-9 H1: `POST /token` writes the keychain bundle, so the
    // credential boolean and the installation row can no longer disagree.
    expect(res.body.data.github).toBe(true);
    expect(res.body.data.openai).toBe(true);
    // No key for the other provider, and OpenAI is the default selection.
    expect(res.body.data.gemini).toBe(false);
    expect(res.body.data.llmProvider).toBe('openai');
    expect(res.body.data.dataDir).toMatch(/^\//);
    expect(res.body.data.commitAnalysisModel).toBe('gpt-4o-mini');
  });

  it('lists branches live from GitHub', async () => {
    const res = await api(testApp.server)
      .get(`/api/integrations/github/repositories/${repositoryId}/branches`)
      .expect(200);

    expect(res.body.data.defaultBranch).toBe(BRANCH);
    const branches = res.body.data.branches as Array<{ name: string }>;
    expect(branches.map((b) => b.name)).toEqual([BRANCH]);
  });

  it('ingests and analyses the branch once Start is pressed', async () => {
    await api(testApp.server)
      .post('/api/integrations/github/repositories/branches')
      .send({
        lookbackDays: 30,
        selections: [{ repositoryId, branch: BRANCH }],
      })
      .expect(202);

    await waitForJobs(db);

    const commits = await db
      .selectFrom('github.commits')
      .select(['id', 'sha'])
      .where('repositoryId', '=', repositoryId)
      .orderBy('sha')
      .execute();
    expect(commits.map((c) => c.sha)).toEqual(['sha-newer', 'sha-older']);

    const branchLinks = await db
      .selectFrom('github.commitBranches')
      .select('branch')
      .where(
        'commitId',
        'in',
        commits.map((c) => c.id),
      )
      .execute();
    expect(branchLinks).toHaveLength(2);
    expect(new Set(branchLinks.map((l) => l.branch))).toEqual(
      new Set([BRANCH]),
    );

    const analyses = await db
      .selectFrom('github.commitAnalyses')
      .select(['status', 'commitType', 'summary', 'promptTokens'])
      .where(
        'commitId',
        'in',
        commits.map((c) => c.id),
      )
      .execute();
    expect(analyses).toHaveLength(2);
    expect(analyses.every((a) => a.status === 'analyzed')).toBe(true);
    expect(analyses.every((a) => a.commitType === 'chore')).toBe(true);
    // Invariant §4.7: token counts are recorded on every analysis.
    expect(analyses.every((a) => a.promptTokens === 10)).toBe(true);
  }, 30_000);

  it('refuses a second branch for the same repository with 409', async () => {
    const res = await api(testApp.server)
      .post('/api/integrations/github/repositories/branches')
      .send({
        lookbackDays: 30,
        selections: [{ repositoryId, branch: 'develop' }],
      })
      .expect(409);

    expect(res.body.code).toBe('GITHUB_REPOSITORY_BRANCHES_LOCKED');
    expect(await trackedBranches(db, repositoryId)).toEqual([BRANCH]);
  });

  it('scopes a project to the repository', async () => {
    const res = await api(testApp.server)
      .post('/api/organizations/current/projects')
      .send({ name: 'Platform', repositoryIds: [repositoryId] })
      .expect(201);

    projectId = res.body.data.id as string;
    expect(res.body.data.repositoryIds).toEqual([repositoryId]);
  });

  it('connects Slack with a pasted bot token', async () => {
    await api(testApp.server)
      .post('/api/integrations/slack/installations/token')
      .send({ token: 'xoxb-e2e' })
      .expect(201);
  });

  it('generates a brief on demand and delivers it to Slack', async () => {
    const res = await api(testApp.server)
      .post('/api/organizations/current/briefs/generate')
      .send({
        scope: { type: 'project', projectId },
        delivery: { slackChannelId: 'C-E2E' },
      })
      .expect(202);

    briefId = res.body.data.briefId as string;
    await waitForJobs(db);

    const brief = await db
      .selectFrom('briefs.briefs')
      .selectAll()
      .where('id', '=', briefId)
      .executeTakeFirstOrThrow();

    expect(brief.status).toBe('delivered');
    expect(brief.title).toBe('Mock brief');
    expect(brief.summary).toBe('Mock brief summary.');
    expect(brief.commitCount).toBe(2);
    expect(brief.model).toBe('gpt-4o-mini');
    // Invariant §4.7 again, this time on the brief row.
    expect(brief.promptTokens).toBe(30);
    expect(brief.completionTokens).toBe(40);
    expect(brief.deliveredAt).not.toBeNull();
    expect(brief.deliveredChannels).toEqual(['slack']);

    const linked = await db
      .selectFrom('briefs.briefCommits')
      .select('sha')
      .where('briefId', '=', briefId)
      .orderBy('sha')
      .execute();
    expect(linked.map((c) => c.sha)).toEqual(['sha-newer', 'sha-older']);

    const { WebClient } = (await import('@slack/web-api')) as unknown as {
      WebClient: {
        __mockInstances: Array<{
          chat: {
            postMessage: {
              mock: { calls: Array<[Record<string, unknown>]> };
            };
          };
        }>;
      };
    };
    const posted = WebClient.__mockInstances
      .flatMap((c) => c.chat.postMessage.mock.calls)
      .map(([arg]) => arg);
    expect(posted.at(-1)?.channel).toBe('C-E2E');
  }, 30_000);

  it('drains the jobs table', async () => {
    // Every enqueue in this file — scan, backfill, analyze, collaborator sync,
    // the boot sweep and the brief — succeeded, and the runner deletes a job
    // row on success. Anything left is a failure the assertions above missed.
    const left = await db.selectFrom('jobs').selectAll().execute();
    expect(left).toEqual([]);
  });
});

function trackedBranches(
  db: Kysely<Database>,
  repositoryId: string,
): Promise<string[]> {
  return db
    .selectFrom('github.repositoryBranches')
    .select('branch')
    .where('repositoryId', '=', repositoryId)
    .where('deletedAt', 'is', null)
    .execute()
    .then((rows) => rows.map((r) => r.branch));
}
