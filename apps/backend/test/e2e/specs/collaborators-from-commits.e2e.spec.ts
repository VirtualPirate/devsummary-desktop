import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { CollaboratorsRepository } from '../../../src/integrations/github/collaborators/repositories/collaborators.repository';
import { createTestDatabase } from '../harness/database';

/**
 * Who an organization can scope a brief to, against a real Postgres — the rule
 * lives entirely in SQL, so a chain mock proves nothing about it.
 *
 * The thing under test is a deliberate inversion: membership is proven by
 * *commit authorship*, not by `github.repository_collaborators`. A GitHub App
 * only sees the access granted directly on a repository, and on a private fork
 * everyone's access is inherited from the parent — so `/collaborators` answers
 * with a near-empty list for exactly the repositories carrying the most
 * history, while every commit still names its author.
 */
describe('collaborators derived from commit authors', () => {
  let db: Kysely<Database>;
  let closeDb: () => Promise<void>;
  let collaborators: CollaboratorsRepository;

  let orgId: string;
  let otherOrgId: string;
  let repoId: string;
  let otherOrgRepoId: string;
  let deadRepoId: string;

  const AUTHOR_ID = 54939412n;
  const GHOST_ID = 15720075n;
  const OTHER_ORG_AUTHOR_ID = 35163507n;
  const DEAD_REPO_AUTHOR_ID = 64607647n;

  const author = (githubUserId: bigint, login: string) => ({
    githubUserId,
    login,
    nodeId: `node-${login}`,
    avatarUrl: `https://avatars.example/${login}`,
    htmlUrl: `https://github.com/${login}`,
    type: 'User',
    siteAdmin: false,
    raw: { id: Number(githubUserId), login },
  });

  const commitRow = (
    repositoryId: string,
    sha: string,
    githubUserId: bigint,
    login: string,
  ) => ({
    repositoryId,
    sha,
    parentCount: 1,
    message: `commit ${sha}`,
    authorGithubUserId: githubUserId,
    authorGithubLogin: login,
    authorName: login,
    authorEmail: `${login}@example.com`,
    committerGithubUserId: githubUserId,
    committerGithubLogin: login,
    committerName: login,
    committerEmail: `${login}@example.com`,
    authoredAt: new Date('2026-05-01T00:00:00Z'),
    committedAt: new Date('2026-05-01T00:00:00Z'),
    raw: JSON.stringify({ sha }),
  });

  async function seedOrg(suffix: string, githubId: bigint) {
    await db
      .insertInto('auth.user')
      .values({
        id: `collab-owner-${suffix}`,
        name: `Collab Owner ${suffix}`,
        email: `collab-owner-${suffix}@example.com`,
        emailVerified: true,
        image: null,
      })
      .execute();

    const org = await db
      .insertInto('organizations')
      .values({
        name: `Collab Org ${suffix}`,
        slug: `collab-org-${suffix}`,
        ownerId: `collab-owner-${suffix}`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const installation = await db
      .insertInto('github.installations')
      .values({
        organizationId: org.id,
        githubInstallationId: githubId,
        githubAccountId: githubId,
        githubAccountLogin: `acct-${suffix}`,
        githubAccountType: 'User',
        targetType: 'User',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return { orgId: org.id, installationId: installation.id };
  }

  async function seedRepo(
    installationId: string,
    githubRepoId: bigint,
    name: string,
    deleted = false,
  ) {
    const repo = await db
      .insertInto('github.repositories')
      .values({
        installationId,
        githubRepoId,
        name,
        fullName: `acct/${name}`,
        private: true,
        deletedAt: deleted ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return repo.id;
  }

  beforeAll(async () => {
    ({ db, close: closeDb } = await createTestDatabase());
    collaborators = new CollaboratorsRepository(db);

    const main = await seedOrg('main', 601n);
    orgId = main.orgId;
    repoId = await seedRepo(main.installationId, 910n, 'fork');
    deadRepoId = await seedRepo(main.installationId, 911n, 'removed', true);

    const other = await seedOrg('other', 602n);
    otherOrgId = other.orgId;
    otherOrgRepoId = await seedRepo(other.installationId, 912n, 'elsewhere');
  });

  afterAll(async () => {
    await closeDb();
  });

  it('starts empty: no commits ingested, nobody to scope to', async () => {
    expect(await collaborators.listByOrganization(orgId)).toEqual([]);
  });

  it('surfaces a commit author the access list never mentioned', async () => {
    await collaborators.upsertManyFromCommitAuthors([
      author(AUTHOR_ID, '0xSmit'),
    ]);

    // Still nothing: the row exists, but no work is attributed to it yet.
    expect(await collaborators.listByOrganization(orgId)).toEqual([]);

    await db
      .insertInto('github.commits')
      .values(commitRow(repoId, 'aaa1', AUTHOR_ID, '0xSmit'))
      .execute();

    const rows = await collaborators.listByOrganization(orgId);
    expect(rows.map((r) => r.login)).toEqual(['0xSmit']);
    expect(rows[0].avatarUrl).toBe('https://avatars.example/0xSmit');
  });

  it('returns one row for an author with many commits', async () => {
    await db
      .insertInto('github.commits')
      .values([
        commitRow(repoId, 'aaa2', AUTHOR_ID, '0xSmit'),
        commitRow(repoId, 'aaa3', AUTHOR_ID, '0xSmit'),
      ])
      .execute();

    const rows = await collaborators.listByOrganization(orgId);
    expect(rows).toHaveLength(1);
  });

  it('excludes someone holding repository access but no ingested work', async () => {
    const ghost = await db
      .insertInto('github.collaborators')
      .values({
        githubUserId: GHOST_ID,
        login: 'Surya-sourav',
        nodeId: null,
        avatarUrl: null,
        htmlUrl: null,
        type: 'User',
        siteAdmin: false,
        raw: JSON.stringify({ id: Number(GHOST_ID), login: 'Surya-sourav' }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('github.repositoryCollaborators')
      .values({
        repositoryId: repoId,
        collaboratorId: ghost.id,
        roleName: 'write',
        permissionAdmin: false,
        permissionMaintain: false,
        permissionPush: true,
        permissionTriage: true,
        permissionPull: true,
        raw: JSON.stringify({}),
      })
      .execute();

    // The old rule would have returned exactly this person and nobody else.
    const rows = await collaborators.listByOrganization(orgId);
    expect(rows.map((r) => r.login)).toEqual(['0xSmit']);
  });

  it('keeps organizations apart', async () => {
    await collaborators.upsertManyFromCommitAuthors([
      author(OTHER_ORG_AUTHOR_ID, 'shivamsaxena12'),
    ]);
    await db
      .insertInto('github.commits')
      .values(
        commitRow(
          otherOrgRepoId,
          'bbb1',
          OTHER_ORG_AUTHOR_ID,
          'shivamsaxena12',
        ),
      )
      .execute();

    expect(
      (await collaborators.listByOrganization(orgId)).map((r) => r.login),
    ).toEqual(['0xSmit']);
    expect(
      (await collaborators.listByOrganization(otherOrgId)).map((r) => r.login),
    ).toEqual(['shivamsaxena12']);
  });

  it('ignores commits under a disconnected repository', async () => {
    await collaborators.upsertManyFromCommitAuthors([
      author(DEAD_REPO_AUTHOR_ID, 'Harshvp412'),
    ]);
    await db
      .insertInto('github.commits')
      .values(commitRow(deadRepoId, 'ccc1', DEAD_REPO_AUTHOR_ID, 'Harshvp412'))
      .execute();

    expect(
      (await collaborators.listByOrganization(orgId)).map((r) => r.login),
    ).toEqual(['0xSmit']);
  });

  it('refreshes identity on re-ingest without clobbering the sync payload', async () => {
    // A row the collaborator sync wrote, carrying role and permissions in `raw`.
    await collaborators.upsertByGithubUserId({
      githubUserId: AUTHOR_ID,
      login: '0xSmit',
      nodeId: 'node-0xSmit',
      avatarUrl: 'https://avatars.example/0xSmit',
      htmlUrl: 'https://github.com/0xSmit',
      type: 'User',
      siteAdmin: false,
      raw: { id: Number(AUTHOR_ID), login: '0xSmit', role_name: 'write' },
    });

    await collaborators.upsertManyFromCommitAuthors([
      { ...author(AUTHOR_ID, 'smit-renamed'), raw: { id: Number(AUTHOR_ID) } },
    ]);

    const row = await collaborators.findByGithubUserId(AUTHOR_ID);
    expect(row?.login).toBe('smit-renamed');
    expect(row?.avatarUrl).toBe('https://avatars.example/smit-renamed');
    // `raw` is a strict superset on the sync side, so ingest must not overwrite
    // it. Read back as `roleName`, not `role_name` — CamelCasePlugin rewrites
    // the keys inside a jsonb value too, not just the column names.
    expect((row?.raw as { roleName?: string }).roleName).toBe('write');
  });

  it('scopes a single lookup to the organization', async () => {
    const [smit] = await collaborators.listByOrganization(orgId);

    expect(
      await collaborators.findByIdScopedToOrg(smit.id, orgId),
    ).toMatchObject({ id: smit.id });
    expect(
      await collaborators.findByIdScopedToOrg(smit.id, otherOrgId),
    ).toBeNull();
  });
});
