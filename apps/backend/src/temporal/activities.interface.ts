import type { Phase } from './search-attributes';

export interface Activities {
  // noop
  'noop.run'(message: string): Promise<void>;

  // collaborators
  'collaborators.syncRepo'(input: {
    repositoryId: string;
    trigger: 'connected' | 'disconnected' | 'webhook' | 'manual';
  }): Promise<void>;

  // commit ingestion
  'commits.backfillFromLatest'(input: {
    repositoryId: string;
    branch: string;
    lookbackDays: number;
  }): Promise<{ inserted: number; sinceISO: string | null }>;
  'commits.backfill'(input: {
    repositoryId: string;
    branch: string;
    sinceISO: string;
  }): Promise<{ inserted: number }>;
  /**
   * What an incremental read is worth fetching — used by both the push webhook
   * and the nightly sweep. `skip` non-null means no GitHub call is needed at all
   * (branch not tracked, or every commit the caller named is already attributed to
   * it). `mode: 'adopt'` means the branch has no stored history to resume from, so
   * the caller should run a lookback-bounded first read instead.
   */
  'commits.planIngest'(input: {
    repositoryId: string;
    branch: string;
    shas: string[];
    truncated: boolean;
    earliestPushedISO: string | null;
  }): Promise<
    | { skip: 'untracked' | 'nothing-new' }
    | { skip: null; mode: 'resume'; sinceISO: string }
    | { skip: null; mode: 'adopt' }
  >;
  /**
   * One page of the nightly sweep's work list: every tracked (repository, branch)
   * pair across all organizations. `runDate` is stamped here rather than in the
   * workflow, which cannot read a clock.
   */
  'commits.listSweepTargets'(input: {
    limit: number;
    after?: { repositoryId: string; branch: string } | null;
  }): Promise<{
    runDate: string;
    targets: Array<{
      repositoryId: string;
      branch: string;
      organizationId: string;
    }>;
    nextCursor: { repositoryId: string; branch: string } | null;
  }>;
  'analysis.planRepoAnalysis'(input: {
    repositoryId: string;
    sinceISO: string;
    force: boolean;
    limit: number;
    after?: { authoredAt: string; id: string } | null;
  }): Promise<{
    commitIds: string[];
    nextCursor: { authoredAt: string; id: string } | null;
  }>;
  'analysis.analyzeCommit'(input: { commitId: string }): Promise<void>;

  // briefs
  'briefs.markGenerating'(input: { briefId: string }): Promise<{
    proceed: boolean;
  }>;
  'briefs.generateContent'(input: { briefId: string }): Promise<{
    terminal: boolean; // true when finished with a terminal failure (do not deliver)
  }>;
  'briefs.deliver'(input: { briefId: string }): Promise<void>;
  'briefs.planBackfill'(input: {
    scheduleId: string;
    backfillMonths?: number;
  }): Promise<{
    briefs: Array<{ briefId: string; organizationId: string }>;
  }>;
  'briefs.claimDue'(): Promise<{
    // `deliver` is false for caught-up missed periods and for re-dispatched
    // stale-pending briefs — only the most recent complete period is sent.
    briefs: Array<{
      briefId: string;
      organizationId: string;
      deliver: boolean;
    }>;
  }>;

  // loc stats
  'loc.zeroFillAndFindMissing'(): Promise<{ repositoryIds: string[] }>;
  'loc.pageRepo'(input: {
    repositoryId: string;
    cursor: string | null;
  }): Promise<{ nextCursor: string | null }>;
}

export type { Phase };
