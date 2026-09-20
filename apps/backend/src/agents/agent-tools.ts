import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GetCommitActivityQuerySchema } from '@launchstack/api-interfaces';
import type { AnalyticsService } from '../analytics/services/analytics.service';
import type { CollaboratorsRepository } from '../integrations/github/collaborators/repositories/collaborators.repository';
import type { AgentDataRepository } from './repositories/agent-data.repository';
import { DEFAULT_WINDOW_DAYS, resolveWindow } from './lib/window';

const COMMIT_TYPES = [
  'fix',
  'feature',
  'optimization',
  'refactor',
  'docs',
  'test',
  'chore',
] as const;

export interface AgentToolDeps {
  data: AgentDataRepository;
  collaborators: CollaboratorsRepository;
  analytics: AnalyticsService;
}

/**
 * Stamped on every payload. The agent has no other source for the current date —
 * see the note on `resolveWindow` for what it cost.
 */
function answer(payload: Record<string, unknown>): string {
  return JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    ...payload,
  });
}

/**
 * The organization is bound here, once, from the membership the request was
 * authorized against — it is never an argument the model can pass. That is the
 * tenant boundary: a tool call cannot name an organization, so it cannot name
 * the wrong one. `organizationId` is deliberately absent from every schema
 * below; if the model invents one it is dropped by schema validation before the
 * call runs.
 */
export function buildAgentTools(organizationId: string, deps: AgentToolDeps) {
  const listRepositories = tool(
    async () =>
      answer({
        repositories: await deps.data.listRepositories(organizationId),
      }),
    {
      name: 'list_repositories',
      description:
        'List the repositories connected to this organization and the branch each one is read on.',
      schema: z.object({}),
    },
  );

  const listCollaborators = tool(
    async () => {
      const rows = await deps.collaborators.listByOrganization(organizationId);
      return answer({
        collaborators: rows.map((c) => ({
          id: c.id,
          login: c.login,
          avatarUrl: c.avatarUrl,
          htmlUrl: c.htmlUrl,
        })),
      });
    },
    {
      name: 'list_collaborators',
      description:
        'List the GitHub collaborators who have authored commits in this organization.',
      schema: z.object({}),
    },
  );

  const searchCommits = tool(
    async (args) => {
      const window = resolveWindow(args, null);
      if (window.kind === 'error') return answer({ error: window.message });
      const commits = await deps.data.searchCommits({
        organizationId,
        repositoryId: args.repositoryId,
        branch: args.branch,
        authorLogin: args.authorLogin,
        commitType: args.commitType,
        from: window.kind === 'window' ? new Date(window.from) : undefined,
        to: window.kind === 'window' ? new Date(window.to) : undefined,
        limit: args.limit ?? 20,
        offset: args.offset ?? 0,
      });
      return answer({
        window: window.kind === 'window' ? window : null,
        commits,
        nextOffset: (args.offset ?? 0) + commits.length,
      });
    },
    {
      name: 'search_commits',
      description:
        'Search commits in this organization. Filter by repository, branch, author login and commit type (fix, feature, optimization, refactor, docs, test, chore). For a period, pass `days` (a lookback from today) — you do not know the current date, so do not write `from`/`to` unless the user named absolute dates. Returns the AI analysis summary for each commit but not its diff.',
      schema: z.object({
        repositoryId: z.uuid().optional(),
        branch: z.string().min(1).max(255).optional(),
        authorLogin: z.string().min(1).max(255).optional(),
        commitType: z.enum(COMMIT_TYPES).optional(),
        days: z.number().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
  );

  const getCommit = tool(
    async ({ commitId }) => {
      const commit = await deps.data.getCommit(organizationId, commitId);
      // Same answer as an id that does not exist. A foreign commit must not be
      // distinguishable from a missing one.
      if (!commit) return answer({ error: 'No such commit' });
      return answer({ commit });
    },
    {
      name: 'get_commit',
      description:
        'Get one commit by its DevSummary id, including its analysis, changed-area list and GitHub link.',
      schema: z.object({ commitId: z.uuid() }),
    },
  );

  const listProjects = tool(
    async () =>
      answer({ projects: await deps.data.listProjects(organizationId) }),
    {
      name: 'list_projects',
      description:
        'List the projects (named groupings of repositories) in this organization.',
      schema: z.object({}),
    },
  );

  const listTeams = tool(
    async () => answer({ teams: await deps.data.listTeams(organizationId) }),
    {
      name: 'list_teams',
      description:
        'List the teams (named groupings of collaborators) in this organization.',
      schema: z.object({}),
    },
  );

  /**
   * Routed through the same `AnalyticsService` the dashboard uses, with the same
   * query schema. A second bucketing implementation is how a report came to
   * disagree with its own brief (Timezones rule 5 in AGENTS.md).
   */
  const activityStats = tool(
    async (args) => {
      const window = resolveWindow(args, DEFAULT_WINDOW_DAYS);
      if (window.kind !== 'window') {
        return answer({
          error: window.kind === 'error' ? window.message : 'No window',
        });
      }
      const query = GetCommitActivityQuerySchema.safeParse({
        from: window.from,
        to: window.to,
        granularity: args.granularity,
        timezone: args.timezone,
        repositoryId: args.repositoryId,
        collaboratorId: args.collaboratorId,
      });
      if (!query.success) {
        return answer({
          error: query.error.issues[0]?.message ?? 'Bad window',
        });
      }
      return answer({
        ...(await deps.analytics.getCommitActivity(organizationId, query.data)),
      });
    },
    {
      name: 'activity_stats',
      description: `Commit counts bucketed over a period, for questions about pace or trend rather than content. Pass \`days\` — a lookback from today, default ${DEFAULT_WINDOW_DAYS} — because you do not know the current date. Only pass \`from\`/\`to\` when the user named absolute dates; a window older than a year is refused.`,
      schema: z.object({
        days: z.number().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        granularity: z.enum(['day', 'week']).optional(),
        timezone: z.string().optional(),
        repositoryId: z.uuid().optional(),
        collaboratorId: z.uuid().optional(),
      }),
    },
  );

  return [
    listRepositories,
    listCollaborators,
    searchCommits,
    getCommit,
    listProjects,
    listTeams,
    activityStats,
  ];
}
