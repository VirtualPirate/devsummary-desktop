import { Inject, Injectable } from '@nestjs/common';
import type { ExpressionBuilder } from 'kysely';
import { KYSELY_DB } from '../../../../databases/kysely';
import type {
  AppDatabase,
  Database,
  GithubCollaboratorSelect,
  GithubCollaboratorsTable,
} from '../../../../databases/kysely';

export type CollaboratorRow = GithubCollaboratorSelect;

export interface UpsertCollaboratorInput {
  githubUserId: bigint;
  login: string;
  nodeId: string | null;
  avatarUrl: string | null;
  htmlUrl: string | null;
  type: string | null;
  siteAdmin: boolean;
  raw: unknown;
}

@Injectable()
export class CollaboratorsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  /**
   * Membership in an organization is proven through **commits**, not through
   * `github.repository_collaborators`.
   *
   * That join table holds the access list, and a GitHub App only ever sees the
   * grants made directly on a repository — on a private fork, permissions
   * inherited from the parent are invisible to the installation, so the access
   * list can be a single row for a repository with thousands of commits by
   * other people. Those people would then be unreachable as a brief scope
   * despite being the only ones with work to report.
   *
   * Authorship is both App-visible (it rides along with `contents: read`) and
   * the better rule anyway: a collaborator is selectable exactly when there is
   * ingested work to attribute to them.
   *
   * EXISTS rather than a join — a collaborator with 4000 commits must not
   * multiply the outer row, and the leading column of
   * `commits_author_authored_at_idx` serves the lookup.
   */
  private authoredCommitsInOrg(
    eb: ExpressionBuilder<Database & { c: GithubCollaboratorsTable }, 'c'>,
    organizationId: string,
  ) {
    return eb.exists(
      eb
        .selectFrom('github.commits as cm')
        .innerJoin('github.repositories as r', 'r.id', 'cm.repositoryId')
        .innerJoin('github.installations as i', 'i.id', 'r.installationId')
        .select('cm.id')
        .whereRef('cm.authorGithubUserId', '=', 'c.githubUserId')
        .where('i.organizationId', '=', organizationId)
        .where('cm.deletedAt', 'is', null)
        // Membership must be proven through a live repo under a live
        // installation, otherwise an author from a disconnected install still
        // passes as org-scoped and can be used as a brief scope.
        .where('r.deletedAt', 'is', null)
        .where('i.deletedAt', 'is', null),
    );
  }

  async findById(
    id: string,
    tx?: AppDatabase,
  ): Promise<CollaboratorRow | null> {
    const row = await this.exec(tx)
      .selectFrom('github.collaborators')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ?? null;
  }

  async findByGithubUserId(
    githubUserId: bigint,
    tx?: AppDatabase,
  ): Promise<CollaboratorRow | null> {
    const row = await this.exec(tx)
      .selectFrom('github.collaborators')
      .selectAll()
      .where('githubUserId', '=', githubUserId)
      .executeTakeFirst();
    return row ?? null;
  }

  async findByIdScopedToOrg(
    collaboratorId: string,
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<CollaboratorRow | null> {
    const row = await this.exec(tx)
      .selectFrom('github.collaborators as c')
      .selectAll('c')
      .where('c.id', '=', collaboratorId)
      .where('c.deletedAt', 'is', null)
      .where((eb) => this.authoredCommitsInOrg(eb, organizationId))
      .executeTakeFirst();
    return row ?? null;
  }

  async listByOrganization(
    organizationId: string,
    tx?: AppDatabase,
  ): Promise<CollaboratorRow[]> {
    return this.exec(tx)
      .selectFrom('github.collaborators as c')
      .selectAll('c')
      .where('c.deletedAt', 'is', null)
      .where((eb) => this.authoredCommitsInOrg(eb, organizationId))
      .orderBy('c.login', 'asc')
      .execute();
  }

  async upsertByGithubUserId(
    input: UpsertCollaboratorInput,
    tx?: AppDatabase,
  ): Promise<CollaboratorRow> {
    return this.exec(tx)
      .insertInto('github.collaborators')
      .values({
        githubUserId: input.githubUserId,
        login: input.login,
        nodeId: input.nodeId,
        avatarUrl: input.avatarUrl,
        htmlUrl: input.htmlUrl,
        type: input.type,
        siteAdmin: input.siteAdmin,
        raw: JSON.stringify(input.raw),
      })
      .onConflict((oc) =>
        oc.column('githubUserId').doUpdateSet({
          login: input.login,
          nodeId: input.nodeId,
          avatarUrl: input.avatarUrl,
          htmlUrl: input.htmlUrl,
          type: input.type,
          siteAdmin: input.siteAdmin,
          raw: JSON.stringify(input.raw),
          deletedAt: null,
          updatedAt: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Record commit authors as collaborators. This is the path that actually
   * populates the table for most repositories — see `authoredCommitsInOrg` for
   * why the access list cannot be trusted to.
   *
   * `raw` is deliberately not overwritten on conflict: a row already written by
   * the collaborator sync carries the richer payload (role name, permissions)
   * and a commit's user object is a strict subset of it. The identity columns
   * are refreshed, so a rename still lands.
   *
   * Deduplicates by GitHub user id first — a page of commits is normally the
   * same handful of authors over and over, and Postgres rejects an ON CONFLICT
   * DO UPDATE that touches the same row twice in one statement.
   */
  async upsertManyFromCommitAuthors(
    authors: UpsertCollaboratorInput[],
    tx?: AppDatabase,
  ): Promise<void> {
    const unique = new Map<string, UpsertCollaboratorInput>();
    for (const author of authors) {
      unique.set(String(author.githubUserId), author);
    }
    if (unique.size === 0) return;

    await this.exec(tx)
      .insertInto('github.collaborators')
      .values(
        [...unique.values()].map((author) => ({
          githubUserId: author.githubUserId,
          login: author.login,
          nodeId: author.nodeId,
          avatarUrl: author.avatarUrl,
          htmlUrl: author.htmlUrl,
          type: author.type,
          siteAdmin: author.siteAdmin,
          raw: JSON.stringify(author.raw),
        })),
      )
      .onConflict((oc) =>
        oc.column('githubUserId').doUpdateSet({
          login: (eb) => eb.ref('excluded.login'),
          nodeId: (eb) => eb.ref('excluded.nodeId'),
          avatarUrl: (eb) => eb.ref('excluded.avatarUrl'),
          htmlUrl: (eb) => eb.ref('excluded.htmlUrl'),
          type: (eb) => eb.ref('excluded.type'),
          siteAdmin: (eb) => eb.ref('excluded.siteAdmin'),
          updatedAt: new Date(),
        }),
      )
      .execute();
  }
}
