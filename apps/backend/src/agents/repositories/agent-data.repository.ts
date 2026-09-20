import { Inject, Injectable } from '@nestjs/common';
import { KYSELY_DB } from '../../databases/kysely';
import type { AppDatabase, GithubCommitType } from '../../databases/kysely';

/**
 * Every query here joins commits -> repositories -> installations and filters on
 * `installations.organization_id`. That join is the tenant boundary in SQL form:
 * there is no code path in this file that reads a commit without it.
 *
 * Raw diffs are never selected. `github.commits.raw` is the largest column in the
 * database and the one most likely to carry secrets a user pasted into a patch.
 */
export const AGENT_MAX_PAGE = 100;

export interface SearchCommitsInput {
  organizationId: string;
  repositoryId?: string;
  branch?: string;
  authorLogin?: string;
  commitType?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

export interface CommitSummaryRow {
  id: string;
  sha: string;
  message: string;
  authorLogin: string | null;
  authorName: string;
  committedAt: Date;
  repositoryFullName: string;
  commitType: string | null;
  summary: string | null;
}

export interface CommitDetailRow extends CommitSummaryRow {
  htmlUrl: string;
  changes: string[] | null;
  additions: number | null;
  deletions: number | null;
}

@Injectable()
export class AgentDataRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  async listRepositories(organizationId: string): Promise<
    Array<{
      id: string;
      fullName: string;
      private: boolean;
      trackedBranch: string | null;
    }>
  > {
    return this.db
      .selectFrom('github.repositories as r')
      .innerJoin('github.installations as i', 'i.id', 'r.installationId')
      .leftJoin('github.repositoryBranches as b', (join) =>
        join.onRef('b.repositoryId', '=', 'r.id').on('b.deletedAt', 'is', null),
      )
      .select([
        'r.id as id',
        'r.fullName as fullName',
        'r.private as private',
        'b.branch as trackedBranch',
      ])
      .where('i.organizationId', '=', organizationId)
      .where('i.deletedAt', 'is', null)
      .where('r.deletedAt', 'is', null)
      .orderBy('r.fullName', 'asc')
      .execute();
  }

  async searchCommits(input: SearchCommitsInput): Promise<CommitSummaryRow[]> {
    let q = this.db
      .selectFrom('github.commits as c')
      .innerJoin('github.repositories as r', 'r.id', 'c.repositoryId')
      .innerJoin('github.installations as i', 'i.id', 'r.installationId')
      .leftJoin('github.commitAnalyses as a', (join) =>
        join.onRef('a.commitId', '=', 'c.id').on('a.deletedAt', 'is', null),
      )
      .select([
        'c.id as id',
        'c.sha as sha',
        'c.message as message',
        'c.authorGithubLogin as authorLogin',
        'c.authorName as authorName',
        'c.committedAt as committedAt',
        'r.fullName as repositoryFullName',
        'a.commitType as commitType',
        'a.summary as summary',
      ])
      .where('i.organizationId', '=', input.organizationId)
      .where('i.deletedAt', 'is', null)
      .where('r.deletedAt', 'is', null)
      .where('c.deletedAt', 'is', null);

    if (input.repositoryId)
      q = q.where('c.repositoryId', '=', input.repositoryId);
    if (input.authorLogin)
      q = q.where('c.authorGithubLogin', '=', input.authorLogin);
    // The DTO validates against the enum before this point; the cast only tells
    // Kysely the string is one of the enum's members.
    if (input.commitType)
      q = q.where('a.commitType', '=', input.commitType as GithubCommitType);
    // Half-open window: start <= t < end. See the Timezones section of AGENTS.md.
    if (input.from) q = q.where('c.committedAt', '>=', input.from);
    if (input.to) q = q.where('c.committedAt', '<', input.to);
    if (input.branch) {
      const branch = input.branch;
      // Not destructured off the expression builder: `unbound-method` flags
      // `exists`/`selectFrom` pulled off it, and they are bound methods.
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('github.commitBranches as cb')
            .select('cb.id')
            .whereRef('cb.commitId', '=', 'c.id')
            .where('cb.branch', '=', branch),
        ),
      );
    }

    return q
      .orderBy('c.committedAt', 'desc')
      .limit(Math.min(Math.max(input.limit, 1), AGENT_MAX_PAGE))
      .offset(Math.max(input.offset, 0))
      .execute();
  }

  async getCommit(
    organizationId: string,
    commitId: string,
  ): Promise<CommitDetailRow | null> {
    const row = await this.db
      .selectFrom('github.commits as c')
      .innerJoin('github.repositories as r', 'r.id', 'c.repositoryId')
      .innerJoin('github.installations as i', 'i.id', 'r.installationId')
      .leftJoin('github.commitAnalyses as a', (join) =>
        join.onRef('a.commitId', '=', 'c.id').on('a.deletedAt', 'is', null),
      )
      .select([
        'c.id as id',
        'c.sha as sha',
        'c.message as message',
        'c.authorGithubLogin as authorLogin',
        'c.authorName as authorName',
        'c.committedAt as committedAt',
        'r.fullName as repositoryFullName',
        'a.commitType as commitType',
        'a.summary as summary',
        'a.changes as changes',
        'a.additions as additions',
        'a.deletions as deletions',
      ])
      .where('c.id', '=', commitId)
      .where('i.organizationId', '=', organizationId)
      .where('i.deletedAt', 'is', null)
      .where('r.deletedAt', 'is', null)
      .where('c.deletedAt', 'is', null)
      .executeTakeFirst();

    if (!row) return null;
    return {
      ...row,
      changes: row.changes ?? null,
      htmlUrl: `https://github.com/${row.repositoryFullName}/commit/${row.sha}`,
    };
  }

  async listProjects(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.db
      .selectFrom('briefs.projects')
      .select(['id', 'name'])
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .orderBy('name', 'asc')
      .execute();
  }

  async listTeams(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.db
      .selectFrom('briefs.teams')
      .select(['id', 'name'])
      .where('organizationId', '=', organizationId)
      .where('deletedAt', 'is', null)
      .orderBy('name', 'asc')
      .execute();
  }
}
