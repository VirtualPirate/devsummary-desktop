import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { CommitsRepository } from '../../../src/integrations/github/commit-analysis/repositories/commits.repository';
import { RepositoryBranchesRepository } from '../../../src/integrations/github/repositories/repository-branches.repository';
import { createTestDatabase } from '../harness/database';

/**
 * The branch model against a real Postgres, because the parts that matter live in
 * constraints and in a write-once rule rather than in ordinary application code:
 * a repository's tracked set can be written exactly once, and the
 * `(commit_id, branch)` unique on `commit_branches` is what makes re-fetching a
 * branch idempotent.
 */
describe('branch tracking + commit attribution', () => {
  let db: Kysely<Database>;
  let closeDb: () => Promise<void>;
  let branches: RepositoryBranchesRepository;
  let commits: CommitsRepository;
  let repoId: string;
  let otherRepoId: string;
  let raceRepoId: string;

  const commitRow = (sha: string, authoredAt: string) => ({
    repositoryId: repoId,
    sha,
    parentCount: 1,
    message: `commit ${sha}`,
    authorGithubUserId: 1n,
    authorGithubLogin: 'alice',
    authorName: 'Alice',
    authorEmail: 'alice@example.com',
    committerGithubUserId: 1n,
    committerGithubLogin: 'alice',
    committerName: 'Alice',
    committerEmail: 'alice@example.com',
    authoredAt: new Date(authoredAt),
    committedAt: new Date(authoredAt),
    raw: { sha },
  });

  beforeAll(async () => {
    ({ db, close: closeDb } = await createTestDatabase());
    branches = new RepositoryBranchesRepository(db);
    commits = new CommitsRepository(db);

    // Inserted directly rather than through the auth harness: this spec never
    // makes an HTTP call, it only needs an owner row the FK can point at.
    await db
      .insertInto('auth.user')
      .values({
        id: 'branch-owner',
        name: 'Branch Owner',
        email: 'branch-owner@example.com',
        emailVerified: true,
        image: null,
      })
      .execute();

    const org = await db
      .insertInto('organizations')
      .values({
        name: 'Branch Org',
        slug: 'branch-org',
        ownerId: 'branch-owner',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const installation = await db
      .insertInto('github.installations')
      .values({
        organizationId: org.id,
        githubInstallationId: 501n,
        githubAccountId: 501n,
        githubAccountLogin: 'acme',
        githubAccountType: 'Organization',
        targetType: 'Organization',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    repoId = (
      await db
        .insertInto('github.repositories')
        .values({
          installationId: installation.id,
          githubRepoId: 900n,
          name: 'api',
          fullName: 'acme/api',
          private: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    otherRepoId = (
      await db
        .insertInto('github.repositories')
        .values({
          installationId: installation.id,
          githubRepoId: 901n,
          name: 'web',
          fullName: 'acme/web',
          private: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    raceRepoId = (
      await db
        .insertInto('github.repositories')
        .values({
          installationId: installation.id,
          githubRepoId: 902n,
          name: 'infra',
          fullName: 'acme/infra',
          private: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await closeDb();
  });

  it('starts with nothing tracked, so a fresh repository is inert', async () => {
    expect(await branches.listByRepository(repoId)).toEqual([]);
  });

  it('writes the branch on the first call', async () => {
    const first = await branches.setBranchOnce(repoId, 'main');
    expect(first).toEqual({ locked: false, added: 'main' });
    expect(await branches.listByRepository(repoId)).toEqual(['main']);
  });

  it('freezes it: no swapping, and no second branch', async () => {
    const swap = await branches.setBranchOnce(repoId, 'release/2026.08');
    expect(swap).toEqual({ locked: true, existing: 'main' });

    const add = await branches.setBranchOnce(repoId, 'develop');
    expect(add.locked).toBe(true);

    const same = await branches.setBranchOnce(repoId, 'main');
    expect(same.locked).toBe(true);

    // Every rejected call wrote nothing.
    expect(await branches.listByRepository(repoId)).toEqual(['main']);
  });

  it('lets exactly one of two concurrent setters win', async () => {
    // Both callers read before either writes unless the row lock serializes them,
    // and the unique index can't help: they insert different branches.
    const [first, second] = await Promise.all([
      branches.setBranchOnce(raceRepoId, 'main'),
      branches.setBranchOnce(raceRepoId, 'develop'),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((o) => !o.locked)).toHaveLength(1);
    expect(outcomes.filter((o) => o.locked)).toHaveLength(1);

    const winner = outcomes.find((o) => !o.locked);
    const tracked = await branches.listByRepository(raceRepoId);
    expect(tracked).toEqual(winner?.locked === false ? [winner.added] : []);
    expect(tracked).toHaveLength(1);
  });

  it('tracks the branch per repository, not globally', async () => {
    await branches.setBranchOnce(otherRepoId, 'develop');
    expect(await branches.listByRepository(otherRepoId)).toEqual(['develop']);

    const map = await branches.listByRepositories([repoId, otherRepoId]);
    expect(map.get(otherRepoId)).toEqual(['develop']);
    expect(map.get(repoId)).toEqual(['main']);
  });

  it('attributes a shared commit to every branch it was fetched on', async () => {
    const shared = await commits.upsertMany([
      commitRow('aaa1', '2026-08-03T10:00:00Z'),
    ]);
    await commits.linkToBranch(
      shared.map((r) => r.id),
      'main',
    );

    // Same sha arriving from the second branch: the upsert must return the
    // existing row's id (DO UPDATE, not DO NOTHING) or the attribution is lost.
    const again = await commits.upsertMany([
      commitRow('aaa1', '2026-08-03T10:00:00Z'),
    ]);
    expect(again[0].id).toBe(shared[0].id);
    await commits.linkToBranch([again[0].id], 'develop');
    // Re-fetching the same branch must not error or duplicate.
    await commits.linkToBranch([again[0].id], 'develop');

    const links = await db
      .selectFrom('github.commitBranches')
      .select('branch')
      .where('commitId', '=', shared[0].id)
      .orderBy('branch')
      .execute();
    expect(links.map((l) => l.branch)).toEqual(['develop', 'main']);
  });

  it('filters brief-scope commits down to one branch', async () => {
    const onlyDevelop = await commits.upsertMany([
      commitRow('bbb2', '2026-08-04T10:00:00Z'),
    ]);
    await commits.linkToBranch(
      onlyDevelop.map((r) => r.id),
      'develop',
    );

    const window = {
      repositoryIds: [repoId],
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-10T00:00:00Z'),
      commitClock: 'committed' as const,
    };

    const everyBranch = await commits.findForBriefScope(window);
    expect(everyBranch.map((r) => r.commit.sha).sort()).toEqual([
      'aaa1',
      'bbb2',
    ]);

    const mainOnly = await commits.findForBriefScope({
      ...window,
      branch: 'main',
    });
    // 'aaa1' is on both branches and must appear exactly once, not once per
    // matching branch row — which is why the filter is EXISTS, not a join.
    expect(mainOnly.map((r) => r.commit.sha)).toEqual(['aaa1']);

    const developOnly = await commits.findForBriefScope({
      ...window,
      branch: 'develop',
    });
    expect(developOnly.map((r) => r.commit.sha).sort()).toEqual([
      'aaa1',
      'bbb2',
    ]);

    const missing = await commits.findForBriefScope({
      ...window,
      branch: 'no-such-branch',
    });
    expect(missing).toEqual([]);
  });
});
