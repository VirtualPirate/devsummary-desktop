import type { Server } from 'node:http';
import type { Kysely } from 'kysely';
import type { Database } from '../../../src/databases/kysely/database.types';
import { api } from '../harness/api';
import { waitForJobs } from '../harness/wait-for-jobs';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WorldAuthor {
  githubId: number;
  login: string;
  name: string;
  email: string;
}

export interface WorldCollaborator {
  githubId: number;
  login: string;
  name: string;
}

export interface WorldCommit {
  sha: string;
  message: string;
  at: Date;
  /** 2 marks a merge commit, which the analyzer skips. */
  parents: number;
}

export interface WorldRepo {
  githubId: number;
  name: string;
  fullName: string;
  /** The branch `seedWorld` tracks, and the only one the fake serves. */
  branch: string;
  private: boolean;
  commits: WorldCommit[];
}

export interface World {
  accountId: number;
  accountLogin: string;
  author: WorldAuthor;
  repositories: WorldRepo[];
  collaborators: WorldCollaborator[];
}

/** Recent, so the default 7-day on-demand brief window covers them. */
export const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY_MS);

/**
 * The single declaration both halves of a fixture come from: the GitHub fake
 * answers out of it, and `seedWorld` drives the real endpoints with it. There
 * is no second place for them to disagree.
 */
export function defineWorld(over: Partial<World> = {}): World {
  const author: WorldAuthor = {
    githubId: 77,
    login: 'ada',
    name: 'Ada',
    email: 'ada@example.com',
  };
  return {
    accountId: 4242,
    accountLogin: 'octo-e2e',
    author,
    repositories: [
      {
        githubId: 900123,
        name: 'api',
        fullName: 'octo-e2e/api',
        branch: 'main',
        private: false,
        commits: [
          {
            sha: 'sha-newer',
            message: 'feat: add the widget endpoint',
            at: daysAgo(2),
            parents: 1,
          },
          {
            sha: 'sha-older',
            message: 'fix: stop the widget leaking',
            at: daysAgo(3),
            parents: 1,
          },
        ],
      },
    ],
    collaborators: [{ githubId: 77, login: 'ada', name: 'Ada' }],
    ...over,
  };
}

/**
 * Bring the app to "connected, tracked and ingested" through its own API.
 *
 * Deliberately not a set of INSERTs: the endpoints own the shape of seven
 * `github.*` tables, and a fixture that wrote them directly would be a second
 * copy of that knowledge, free to rot. Costs one real ingest run, which is
 * seconds against the in-memory database.
 *
 * Requires `installGithub(world)` to have run first.
 */
export async function seedWorld(
  server: Server,
  db: Kysely<Database>,
  world: World,
): Promise<Record<string, string>> {
  const connected = await api(server)
    .post('/api/integrations/github/token')
    .send({ token: 'github_pat_e2e' })
    .expect(201);

  const repositories = connected.body.data.repositories as Array<{
    id: string;
    fullName: string;
  }>;
  const byFullName = Object.fromEntries(
    repositories.map((r) => [r.fullName, r.id]),
  );

  await api(server)
    .post('/api/integrations/github/repositories/branches')
    .send({
      lookbackDays: 30,
      selections: world.repositories.map((repo) => ({
        repositoryId: byFullName[repo.fullName],
        branch: repo.branch,
      })),
    })
    .expect(202);

  await waitForJobs(db);
  return byFullName;
}
