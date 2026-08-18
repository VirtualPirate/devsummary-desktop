import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AppError } from '../../common/errors';
import { KYSELY_DB, type AppDatabase } from '../../databases/kysely';

export interface CommitActivityRow {
  bucket: string; // YYYY-MM-DD bucket start in the requested timezone
  commits: number;
  additions: number;
  deletions: number;
  feature: number;
  fix: number;
  optimization: number;
  refactor: number;
  docs: number;
  test: number;
  chore: number;
}

export interface CommitActivityQueryArgs {
  organizationId: string;
  from: Date;
  to: Date;
  granularity: 'day' | 'week';
  timezone: string;
  repositoryId?: string;
  authorGithubUserId?: bigint;
}

// Closed set mirroring the github.commit_type enum; inlined as SQL
// literals because a bound text parameter cannot be compared to a PG
// enum without an explicit cast.
const COMMIT_TYPE_LITERALS = [
  'feature',
  'fix',
  'optimization',
  'refactor',
  'docs',
  'test',
  'chore',
] as const;

/** Postgres SQLSTATE for invalid_parameter_value — what `AT TIME ZONE`
 * raises for a zone name missing from its tzdata. */
const PG_INVALID_PARAMETER_VALUE = '22023';

function isUnrecognizedTimezoneError(err: unknown): boolean {
  const cause = (err as { cause?: unknown })?.cause ?? err;
  return (cause as { code?: unknown })?.code === PG_INVALID_PARAMETER_VALUE;
}

@Injectable()
export class CommitActivityRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  async aggregate(args: CommitActivityQueryArgs): Promise<CommitActivityRow[]> {
    try {
      return await this.runAggregate(args);
    } catch (err) {
      // The service normalizes known CLDR-legacy ids; this is the net
      // for zones Node's Intl accepts but PG's tzdata does not.
      if (isUnrecognizedTimezoneError(err)) {
        throw AppError.ANALYTICS_TIMEZONE_UNSUPPORTED({
          timezone: args.timezone,
        });
      }
      throw err;
    }
  }

  private async runAggregate(
    args: CommitActivityQueryArgs,
  ): Promise<CommitActivityRow[]> {
    // granularity is schema-validated to 'day' | 'week'; safe to inline.
    const bucket = sql<string>`to_char(date_trunc(${sql.raw(
      `'${args.granularity}'`,
    )}, ${sql.ref('github.commits.authoredAt')} at time zone ${args.timezone}), 'YYYY-MM-DD')`;

    const typed = (t: (typeof COMMIT_TYPE_LITERALS)[number]) =>
      sql<number>`count(*) filter (where ${sql.ref(
        'github.commitAnalyses.status',
      )} = 'analyzed' and ${sql.ref(
        'github.commitAnalyses.commitType',
      )} = ${sql.raw(`'${t}'`)})::int`;

    let query = this.db
      .selectFrom('github.commits')
      .innerJoin('github.repositories', (join) =>
        join
          .onRef('github.repositories.id', '=', 'github.commits.repositoryId')
          .on('github.repositories.deletedAt', 'is', null),
      )
      .innerJoin('github.installations', (join) =>
        join
          .onRef(
            'github.installations.id',
            '=',
            'github.repositories.installationId',
          )
          .on('github.installations.deletedAt', 'is', null),
      )
      .leftJoin('github.commitAnalyses', (join) =>
        join
          .onRef('github.commitAnalyses.commitId', '=', 'github.commits.id')
          .on('github.commitAnalyses.deletedAt', 'is', null),
      )
      .where('github.commits.deletedAt', 'is', null)
      .where('github.commits.authoredAt', '>=', args.from)
      .where('github.commits.authoredAt', '<', args.to)
      .where('github.installations.organizationId', '=', args.organizationId);

    if (args.repositoryId) {
      query = query.where(
        'github.commits.repositoryId',
        '=',
        args.repositoryId,
      );
    }
    if (args.authorGithubUserId !== undefined) {
      query = query.where(
        'github.commits.authorGithubUserId',
        '=',
        args.authorGithubUserId,
      );
    }

    return (
      query
        .select([
          bucket.as('bucket'),
          sql<number>`count(*)::int`.as('commits'),
          sql<number>`coalesce(sum(${sql.ref(
            'github.commitAnalyses.additions',
          )}), 0)::int`.as('additions'),
          sql<number>`coalesce(sum(${sql.ref(
            'github.commitAnalyses.deletions',
          )}), 0)::int`.as('deletions'),
          typed('feature').as('feature'),
          typed('fix').as('fix'),
          typed('optimization').as('optimization'),
          typed('refactor').as('refactor'),
          typed('docs').as('docs'),
          typed('test').as('test'),
          typed('chore').as('chore'),
        ])
        // Ordinal references: repeating the bucket expression would bind the
        // timezone as a fresh parameter each time, and Postgres then rejects
        // the GROUP BY as not matching the SELECT expression.
        .groupBy(sql.raw('1'))
        .orderBy(sql.raw('1'))
        .execute()
    );
  }
}
