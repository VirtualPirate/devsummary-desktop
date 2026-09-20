import { Injectable } from '@nestjs/common';
import type {
  BriefCommitResponse,
  ListCommitsQuery,
  PaginatedCommits,
} from '@launchstack/api-interfaces';
import { AppError } from '../../common/errors';
import {
  CommitsListRepository,
  type CommitListRow,
} from '../repositories/commits-list.repository';

@Injectable()
export class CommitsService {
  constructor(private readonly commits: CommitsListRepository) {}

  async list(
    organizationId: string,
    q: ListCommitsQuery,
  ): Promise<PaginatedCommits> {
    const cursor = q.cursor ? this.decodeCursor(q.cursor) : null;
    const rows = await this.commits.list({
      organizationId,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      commitType: q.commitType,
      repositoryId: q.repositoryId,
      analyzedOnly: q.analyzedOnly,
      limit: q.limit + 1,
      cursorAuthoredAt: cursor?.authoredAt,
      cursorId: cursor?.id,
    });

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? this.encodeCursor({
            authoredAt: last.authoredAt.toISOString(),
            id: last.id,
          })
        : null;

    return { items: page.map((r) => this.toCommitResponse(r)), nextCursor };
  }

  private toCommitResponse(r: CommitListRow): BriefCommitResponse {
    const githubUrl =
      r.repositoryFullName && r.sha
        ? `https://github.com/${r.repositoryFullName}/commit/${r.sha}`
        : null;
    const analysis =
      r.analysisStatus === 'analyzed' && r.analysisCommitType
        ? {
            commitType: r.analysisCommitType,
            summary: r.analysisSummary ?? '',
            changes: r.analysisChanges ?? [],
          }
        : null;
    return {
      sha: r.sha,
      commitId: r.id,
      repositoryFullName: r.repositoryFullName,
      authorName: r.authorName,
      authorLogin: r.authorLogin,
      messageFirstLine: r.message ? r.message.split('\n', 1)[0] : null,
      authoredAt: r.authoredAt.toISOString(),
      githubUrl,
      analysis,
    };
  }

  private encodeCursor(c: { authoredAt: string; id: string }): string {
    return Buffer.from(JSON.stringify(c)).toString('base64url');
  }

  private decodeCursor(s: string): { authoredAt: Date; id: string } {
    try {
      const obj = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as {
        authoredAt: string;
        id: string;
      };
      return { authoredAt: new Date(obj.authoredAt), id: obj.id };
    } catch {
      throw AppError.BAD_REQUEST({ message: 'Invalid cursor' });
    }
  }
}
