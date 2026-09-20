import { Inject, Injectable } from '@nestjs/common';
import {
  KYSELY_DB,
  type AppDatabase,
  type GithubCommitType,
} from '../../databases/kysely';

export interface CommitListRow {
  id: string;
  sha: string;
  authoredAt: Date;
  authorName: string | null;
  authorLogin: string | null;
  message: string | null;
  repositoryFullName: string | null;
  analysisStatus: string | null;
  analysisCommitType: string | null;
  analysisSummary: string | null;
  analysisChanges: string[] | null;
}

export interface ListCommitsArgs {
  organizationId: string;
  /** Inclusive. */
  from?: Date;
  /** Exclusive. */
  to?: Date;
  commitType?: GithubCommitType | 'unclassified';
  repositoryId?: string;
  analyzedOnly?: boolean;
  limit: number;
  cursorAuthoredAt?: Date;
  cursorId?: string;
}

@Injectable()
export class CommitsListRepository {
  constructor(@Inject(KYSELY_DB) private readonly db: AppDatabase) {}

  async list(args: ListCommitsArgs): Promise<CommitListRow[]> {
    // Org scoping copied from `CommitActivityRepository.scopedCommits`:
    // commits -> repositories -> installations, every join filtering
    // `deletedAt is null`. Merge commits are deliberately not excluded — they
    // show up as unanalyzed rows once "Analyzed only" is switched off.
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
      .select([
        'github.commits.id as id',
        'github.commits.sha as sha',
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
      .where('github.commits.deletedAt', 'is', null)
      .where('github.installations.organizationId', '=', args.organizationId);

    // Half-open window: `>= from`, `< to`. Both bounds optional and independent.
    if (args.from) {
      query = query.where('github.commits.authoredAt', '>=', args.from);
    }
    if (args.to) {
      query = query.where('github.commits.authoredAt', '<', args.to);
    }
    if (args.repositoryId) {
      query = query.where(
        'github.commits.repositoryId',
        '=',
        args.repositoryId,
      );
    }
    if (args.analyzedOnly) {
      query = query.where('github.commitAnalyses.status', '=', 'analyzed');
    }
    if (args.commitType === 'unclassified') {
      // Mirrors `BriefCommitsRepository.listForBrief`'s `unclassified` branch:
      // no analysis row, an unfinished/failed one, or an analysed one with no
      // type. Combined with `analyzedOnly` it legitimately matches nothing.
      query = query.where((eb) =>
        eb.or([
          eb('github.commitAnalyses.status', 'is', null),
          eb('github.commitAnalyses.status', '!=', 'analyzed'),
          eb('github.commitAnalyses.commitType', 'is', null),
        ]),
      );
    } else if (args.commitType) {
      query = query
        .where('github.commitAnalyses.status', '=', 'analyzed')
        .where('github.commitAnalyses.commitType', '=', args.commitType);
    }

    // Keyset on (authoredAt desc, id desc). `authoredAt` is NOT NULL here, so
    // none of `listForBrief`'s nulls-last handling is needed.
    if (args.cursorId && args.cursorAuthoredAt) {
      const { cursorId, cursorAuthoredAt } = args;
      query = query.where((eb) =>
        eb.or([
          eb('github.commits.authoredAt', '<', cursorAuthoredAt),
          eb.and([
            eb('github.commits.authoredAt', '=', cursorAuthoredAt),
            eb('github.commits.id', '<', cursorId),
          ]),
        ]),
      );
    }

    return query
      .orderBy('github.commits.authoredAt', 'desc')
      .orderBy('github.commits.id', 'desc')
      .limit(args.limit)
      .execute();
  }
}
