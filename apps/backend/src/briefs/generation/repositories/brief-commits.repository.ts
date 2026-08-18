import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  chunk,
  KYSELY_DB,
  type AppDatabase,
  type GithubCommitType,
} from '../../../databases/kysely';

/**
 * The identity a commit is filtered and grouped by. Login when GitHub knows one,
 * else the raw git author name — the same fallback the commit list renders, so a
 * contributor facet value always filters to the rows it was counted from.
 * Written raw (not `sql.ref`) because it must match verbatim in the SELECT list,
 * the GROUP BY, and the list query's WHERE.
 */
const CONTRIBUTOR_KEY = sql<
  string | null
>`coalesce(github.commits.author_github_login, github.commits.author_name)`;

export interface BriefCommitLink {
  commitId: string;
  sha: string;
}

export interface BriefCommitTypeCountRow {
  briefId: string;
  // The github commit_type enum value, or null when the commit has no
  // usable analysis (missing link, missing/failed/skipped analysis).
  commitType: string | null;
  count: number;
}

export interface BriefContributorRow {
  // Never null: null keys are filtered out, since nothing can select them.
  key: string;
  commits: number;
}

export interface BriefCommitRow {
  briefCommitId: string;
  sha: string;
  commitId: string | null;
  authoredAt: Date | null;
  authorName: string | null;
  authorLogin: string | null;
  message: string | null;
  repositoryFullName: string | null;
  analysisStatus: string | null;
  analysisCommitType: string | null;
  analysisSummary: string | null;
  analysisChanges: string[] | null;
}

@Injectable()
export class BriefCommitsRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  private exec(tx?: AppDatabase): AppDatabase {
    return tx ?? this.db;
  }

  /**
   * A link row binds 3 columns, so one statement would hit the bind-parameter
   * cap at 21845 links — reachable as soon as the brief commit query stops
   * truncating at 5000 (`docs/scale-ceilings.md`). Written in `chunk()` batches.
   *
   * The delete and the inserts run in one transaction — its own when the caller
   * supplies no `tx`, which today none does. Splitting the insert is what makes
   * partial state possible, and unlike the chunked commit writes nothing repairs
   * it: a crash between batches would leave the brief reporting a commit count
   * it links only a fraction of, which reads as a working brief.
   */
  async replaceForBrief(
    briefId: string,
    links: BriefCommitLink[],
    tx?: AppDatabase,
  ): Promise<void> {
    const run = async (executor: AppDatabase): Promise<void> => {
      await executor
        .deleteFrom('briefs.briefCommits')
        .where('briefId', '=', briefId)
        .execute();
      for (const batch of chunk(links)) {
        await executor
          .insertInto('briefs.briefCommits')
          .values(
            batch.map((l) => ({
              briefId,
              commitId: l.commitId,
              sha: l.sha,
            })),
          )
          .execute();
      }
    };

    return tx ? run(tx) : this.db.transaction().execute(run);
  }

  async listForBrief(input: {
    briefId: string;
    limit: number;
    cursorAuthoredAt?: Date | null;
    cursorId?: string;
    /** Compared against `CONTRIBUTOR_KEY` — login, else raw author name. */
    contributor?: string;
    /** A github commit_type, or 'unclassified' for rows with no analysed analysis. */
    commitType?: GithubCommitType | 'unclassified';
    tx?: AppDatabase;
  }): Promise<BriefCommitRow[]> {
    let query = this.exec(input.tx)
      .selectFrom('briefs.briefCommits')
      .leftJoin(
        'github.commits',
        'github.commits.id',
        'briefs.briefCommits.commitId',
      )
      .leftJoin(
        'github.commitAnalyses',
        'github.commitAnalyses.commitId',
        'github.commits.id',
      )
      .leftJoin(
        'github.repositories',
        'github.repositories.id',
        'github.commits.repositoryId',
      )
      .select([
        'briefs.briefCommits.id as briefCommitId',
        'briefs.briefCommits.sha as sha',
        'briefs.briefCommits.commitId as commitId',
        'github.commits.authoredAt as authoredAt',
        'github.commits.authorName as authorName',
        'github.commits.authorGithubLogin as authorLogin',
        'github.commits.message as message',
        'github.repositories.fullName as repositoryFullName',
        'github.commitAnalyses.status as analysisStatus',
        'github.commitAnalyses.commitType as analysisCommitType',
        'github.commitAnalyses.summary as analysisSummary',
        'github.commitAnalyses.changes as analysisChanges',
      ])
      .where('briefs.briefCommits.briefId', '=', input.briefId);
    if (input.contributor) {
      query = query.where(
        sql<boolean>`${CONTRIBUTOR_KEY} = ${input.contributor}`,
      );
    }
    if (input.commitType === 'unclassified') {
      // Mirrors `countTypesForBriefs`' `unclassified` bucket: no analysis row,
      // an unfinished/failed one, or an analysed one with no type.
      query = query.where((eb) =>
        eb.or([
          eb('github.commitAnalyses.status', 'is', null),
          eb('github.commitAnalyses.status', '!=', 'analyzed'),
          eb('github.commitAnalyses.commitType', 'is', null),
        ]),
      );
    } else if (input.commitType) {
      query = query
        .where('github.commitAnalyses.status', '=', 'analyzed')
        .where('github.commitAnalyses.commitType', '=', input.commitType);
    }
    if (input.cursorId) {
      const { cursorId } = input;
      if (input.cursorAuthoredAt) {
        // nulls sort last, so the "after" set is: earlier authoredAt,
        // OR same authoredAt with a smaller link id, OR any null-authoredAt row.
        const { cursorAuthoredAt } = input;
        query = query.where((eb) =>
          eb.or([
            eb('github.commits.authoredAt', '<', cursorAuthoredAt),
            eb.and([
              eb('github.commits.authoredAt', '=', cursorAuthoredAt),
              eb('briefs.briefCommits.id', '<', cursorId),
            ]),
            eb('github.commits.authoredAt', 'is', null),
          ]),
        );
      } else {
        // already in the null-authoredAt tail; page by link id.
        query = query
          .where('github.commits.authoredAt', 'is', null)
          .where('briefs.briefCommits.id', '<', cursorId);
      }
    }
    return query
      .orderBy(sql`github.commits.authored_at desc nulls last`)
      .orderBy('briefs.briefCommits.id', 'desc')
      .limit(input.limit)
      .execute();
  }

  /**
   * Filter options for the brief's commit list, over the brief's frozen link set
   * (not the live scope), so every option matches at least one listed row.
   * Deliberately ignores the caller's filters — the dropdown must not shrink to
   * the one contributor already selected.
   */
  async listContributorsForBrief(
    briefId: string,
    tx?: AppDatabase,
  ): Promise<BriefContributorRow[]> {
    return this.exec(tx)
      .selectFrom('briefs.briefCommits')
      .innerJoin(
        'github.commits',
        'github.commits.id',
        'briefs.briefCommits.commitId',
      )
      .select([
        CONTRIBUTOR_KEY.as('key'),
        sql<number>`count(*)::int`.as('commits'),
      ])
      .where('briefs.briefCommits.briefId', '=', briefId)
      .where(sql<boolean>`${CONTRIBUTOR_KEY} is not null`)
      .groupBy(CONTRIBUTOR_KEY)
      .orderBy(sql`count(*) desc`)
      .orderBy(CONTRIBUTOR_KEY)
      .execute() as Promise<BriefContributorRow[]>;
  }

  async countTypesForBriefs(
    briefIds: string[],
    tx?: AppDatabase,
  ): Promise<BriefCommitTypeCountRow[]> {
    if (briefIds.length === 0) return [];
    const executor = this.exec(tx);
    // A commit may have been re-analyzed; only its most recent analysis
    // counts, so each commit contributes exactly one row to the totals.
    const typeExpr = sql<
      string | null
    >`case when ${sql.ref('latestAnalyses.status')} = 'analyzed' then ${sql.ref('latestAnalyses.commitType')} end`;
    return executor
      .selectFrom('briefs.briefCommits')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('github.commitAnalyses')
            .select(['commitId', 'commitType', 'status'])
            .distinctOn('commitId')
            .orderBy('commitId')
            .orderBy('analyzedAt', 'desc')
            .as('latestAnalyses'),
        (join) =>
          join.onRef(
            'latestAnalyses.commitId',
            '=',
            'briefs.briefCommits.commitId',
          ),
      )
      .select([
        'briefs.briefCommits.briefId as briefId',
        typeExpr.as('commitType'),
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('briefs.briefCommits.briefId', 'in', briefIds)
      .groupBy(['briefs.briefCommits.briefId', typeExpr])
      .execute();
  }
}
