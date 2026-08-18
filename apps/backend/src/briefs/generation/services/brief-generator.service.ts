import { Inject, Injectable } from '@nestjs/common';
import type { BriefHighlight } from '@launchstack/api-interfaces';
import { AppError } from '../../../common/errors';
import type { BriefCommitClock } from '../../../databases/kysely';
import type { BriefsConfig } from '../../briefs-config';
import { BRIEFS_CONFIG_TOKEN } from '../../tokens';
import { CommitsRepository } from '../../../integrations/github/commit-analysis/repositories/commits.repository';
import { OpenAIBriefClient } from './openai-brief.client';
import { BriefScopeResolver } from './brief-scope.resolver';
import type { BriefScope } from './brief-scope.resolver';
import {
  BRIEF_SYSTEM_PROMPT,
  buildBriefUserPrompt,
  type BriefPromptCommit,
} from './brief-summary-prompt';

export type { BriefScope };

export interface GenerateInput {
  organizationId: string;
  scope: BriefScope;
  period: { start: Date; end: Date };
  /** The zone `period`'s boundaries are local midnights in. */
  timezone: string;
  /** The brief's own `commitClock` — which git date bounds the period. */
  commitClock: BriefCommitClock;
}

export type GenerateOutput =
  | {
      kind: 'empty';
      scopeLabel: string;
      contributorCount: 0;
      commitCount: 0;
    }
  | {
      kind: 'generated';
      scopeLabel: string;
      title: string;
      summary: string;
      highlights: BriefHighlight[];
      contributorCount: number;
      commitCount: number;
      model: string;
      promptTokens: number | null;
      completionTokens: number | null;
      commits: Array<{ commitId: string; sha: string }>;
    };

@Injectable()
export class BriefGeneratorService {
  constructor(
    private readonly commits: CommitsRepository,
    private readonly scopeResolver: BriefScopeResolver,
    private readonly openai: OpenAIBriefClient,
    @Inject(BRIEFS_CONFIG_TOKEN) private readonly config: BriefsConfig | null,
  ) {}

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    // `loadBriefsConfig` returns null without OPENAI_API_KEY. Fail with the
    // registered code up front rather than dereferencing null further down,
    // where the TypeError would be retried and stored as the failure reason.
    const config = this.config;
    if (!config) throw AppError.OPENAI_NOT_CONFIGURED();

    const { repositoryIds, scopeLabel, authorFilter, branchFilter } =
      await this.scopeResolver.resolve(input);

    const rows = await this.commits.findForBriefScope({
      repositoryIds,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      commitClock: input.commitClock,
      collaboratorGithubUserIds: authorFilter,
      branch: branchFilter,
    });

    if (rows.length === 0) {
      return { kind: 'empty', scopeLabel, contributorCount: 0, commitCount: 0 };
    }

    const distinctAuthors = new Set<string>();
    const promptCommits: BriefPromptCommit[] = [];
    const commitLinks: Array<{ commitId: string; sha: string }> = [];
    for (const r of rows) {
      commitLinks.push({ commitId: r.commit.id, sha: r.commit.sha });
      const authorKey = r.commit.authorGithubUserId
        ? String(r.commit.authorGithubUserId)
        : `${r.commit.authorEmail}|${r.commit.authorName}`;
      distinctAuthors.add(authorKey);
      promptCommits.push({
        sha: r.commit.sha,
        authorName: r.commit.authorName,
        authorEmail: r.commit.authorEmail,
        messageFirstLine: r.commit.message.split('\n', 1)[0],
        analysis:
          r.analysis &&
          r.analysis.status === 'analyzed' &&
          r.analysis.commitType
            ? {
                commitType: r.analysis.commitType,
                summary: r.analysis.summary ?? '',
                changes: r.analysis.changes ?? [],
              }
            : null,
      });
    }

    const userPrompt = buildBriefUserPrompt({
      scopeLabel,
      period: input.period,
      timezone: input.timezone,
      commits: promptCommits,
      maxChars: config.maxPromptChars,
    });

    const result = await this.openai.generate({
      systemPrompt: BRIEF_SYSTEM_PROMPT,
      userPrompt,
    });

    return {
      kind: 'generated',
      scopeLabel,
      title: result.parsed.title,
      summary: result.parsed.summary,
      highlights: result.parsed.highlights,
      contributorCount: distinctAuthors.size,
      commitCount: rows.length,
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      commits: commitLinks,
    };
  }
}
