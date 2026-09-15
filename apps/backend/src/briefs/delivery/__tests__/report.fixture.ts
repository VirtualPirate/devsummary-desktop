import type { BriefReportResponse } from '@launchstack/api-interfaces';

/** Shared by the Slack-block specs — same brief, same figures. */
export const brief = {
  id: 'b1',
  title: 'Mobile shipped notifications',
  briefInfoTitle: 'May 19 – May 25, 2026 · 3 contributors · 24 commits',
  summary: 'We shipped notifications and improved checkout perf.',
  highlights: [
    {
      title: 'Push notifications are live',
      detail: 'Users get order updates.',
    },
  ],
};

export const APP_URL = 'https://app.devsummary.test';

export function day(date: string, commits: number) {
  return {
    date,
    counts: {
      feature: commits,
      fix: 0,
      optimization: 0,
      refactor: 0,
      upkeep: 0,
      unclassified: 0,
    },
    linesAdded: 0,
    linesRemoved: 0,
  };
}

export function report(
  overrides: Partial<BriefReportResponse> = {},
): BriefReportResponse {
  return {
    briefId: 'b1',
    scopeDeleted: false,
    timezone: 'Asia/Kolkata',
    totals: {
      commits: 24,
      contributors: 3,
      repositoriesTouched: 2,
      repositoriesInScope: 5,
      linesAdded: 12431,
      linesRemoved: 3880,
      busiestDay: { date: '2026-05-21', commits: 9 },
    },
    deltas: {
      commits: 0.31,
      contributors: 2,
      linesAdded: null,
      linesRemoved: null,
    },
    daily: [day('2026-05-19', 4), day('2026-05-20', 0), day('2026-05-21', 9)],
    workBreakdown: [
      { category: 'feature' as const, commits: 21 },
      { category: 'upkeep' as const, commits: 1 },
    ],
    contributors: [],
    repositories: [
      {
        repositoryId: 'r1',
        fullName: 'acme/api',
        commits: 18,
        linesAdded: 900,
        linesRemoved: 120,
      },
      {
        repositoryId: 'r2',
        fullName: 'acme/web',
        commits: 6,
        linesAdded: 400,
        linesRemoved: 60,
      },
    ],
    locCoverage: { withLoc: 24, total: 24 },
    ...overrides,
  };
}
