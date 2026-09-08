import { BriefGeneratorService } from '../services/brief-generator.service';

function makeService(overrides: { config?: unknown } = {}) {
  const commits = { findForBriefScope: jest.fn() };
  const scopeResolver = { resolve: jest.fn() };
  const llm = { parse: jest.fn() };
  const config =
    'config' in overrides
      ? overrides.config
      : {
          llm: { provider: 'openai', apiKey: 'k', model: 'gpt-x' },
          maxPromptChars: 10_000,
          dispatcherIntervalSeconds: 60,
          backfillMaxBriefs: 100,
        };
  const svc = new BriefGeneratorService(
    commits as any,
    scopeResolver as any,
    llm as any,
    config as any,
  );
  return { svc, commits, scopeResolver, llm };
}

// Half-open: `end` is the next local midnight after the last covered day.
const period = {
  start: new Date('2026-05-18T00:00:00Z'),
  end: new Date('2026-05-25T00:00:00Z'),
};

describe('BriefGeneratorService.generate', () => {
  // `config.llm` is null until the user pastes a key for the selected provider.
  // This used to die on `this.config.maxPromptChars` with a TypeError that got
  // stored verbatim in failure_reason and retried four times.
  it('raises OPENAI_NOT_CONFIGURED when no provider key is set', async () => {
    const { svc, scopeResolver, commits } = makeService({
      config: { llm: null, maxPromptChars: 30_000 },
    });
    await expect(
      svc.generate({
        organizationId: 'o1',
        scope: { type: 'project', projectId: 'p1' },
        period,
        timezone: 'UTC',
        commitClock: 'committed',
      }),
    ).rejects.toMatchObject({ code: 'OPENAI_NOT_CONFIGURED' });
    expect(scopeResolver.resolve).not.toHaveBeenCalled();
    expect(commits.findForBriefScope).not.toHaveBeenCalled();
  });

  it('returns empty-period result when no commits found', async () => {
    const { svc, scopeResolver, commits } = makeService();
    scopeResolver.resolve.mockResolvedValue({
      repositoryIds: ['r1'],
      scopeLabel: 'Project: Mobile',
    });
    commits.findForBriefScope.mockResolvedValue([]);
    const out = await svc.generate({
      organizationId: 'o1',
      scope: { type: 'project', projectId: 'p1' },
      period,
      timezone: 'UTC',
      commitClock: 'committed',
    });
    expect(out.kind).toBe('empty');
    if (out.kind === 'empty') {
      expect(out.contributorCount).toBe(0);
      expect(out.commitCount).toBe(0);
    }
  });

  it('calls LLM and returns title+summary for non-empty period', async () => {
    const { svc, scopeResolver, commits, llm } = makeService();
    scopeResolver.resolve.mockResolvedValue({
      repositoryIds: ['r1'],
      scopeLabel: 'Project: Mobile',
    });
    commits.findForBriefScope.mockResolvedValue([
      {
        commit: {
          id: 'c1',
          sha: 'abc',
          authorName: 'Ada',
          authorEmail: 'a@x.io',
          authorGithubUserId: BigInt(1),
          message: 'feat: x',
          authoredAt: new Date('2026-05-20T00:00:00Z'),
          parentCount: 1,
          repositoryId: 'r1',
        },
        analysis: {
          commitType: 'feature',
          summary: 'add X',
          changes: ['c1'],
          status: 'analyzed',
        },
      },
    ]);
    llm.parse.mockResolvedValue({
      parsed: { title: 'Mobile shipped X', summary: 'We did stuff.' },
      model: 'gpt-x',
      promptTokens: 100,
      completionTokens: 30,
    });
    const out = await svc.generate({
      organizationId: 'o1',
      scope: { type: 'project', projectId: 'p1' },
      period,
      timezone: 'UTC',
      commitClock: 'committed',
    });
    expect(out.kind).toBe('generated');
    if (out.kind === 'generated') {
      expect(out.title).toBe('Mobile shipped X');
      expect(out.commitCount).toBe(1);
      expect(out.contributorCount).toBe(1);
      expect(out.commits).toEqual([{ commitId: 'c1', sha: 'abc' }]);
    }
  });

  it('threads highlights out of the LLM result', async () => {
    const { svc, scopeResolver, commits, llm } = makeService();
    scopeResolver.resolve.mockResolvedValue({
      repositoryIds: ['r1'],
      scopeLabel: 'Project: Checkout',
    });
    commits.findForBriefScope.mockResolvedValue([
      {
        commit: {
          id: 'c1',
          sha: 'abc123',
          authorGithubUserId: 1n,
          authorName: 'Ada',
          authorEmail: 'ada@x.io',
          message: 'feat: guest checkout',
        },
        analysis: null,
      },
    ]);
    llm.parse.mockResolvedValue({
      parsed: {
        title: 'Guest checkout shipped',
        summary: 'Buyers can pay without an account.',
        highlights: [
          {
            title: 'Guest checkout is live',
            detail: 'Rolled out to all traffic on Tuesday.',
          },
        ],
      },
      model: 'gpt-x',
      promptTokens: 100,
      completionTokens: 20,
    });

    const out = await svc.generate({
      organizationId: 'o1',
      scope: { type: 'project', projectId: 'p1' },
      period,
      timezone: 'UTC',
      commitClock: 'committed',
    });

    expect(out.kind).toBe('generated');
    if (out.kind !== 'generated') throw new Error('unreachable');
    expect(out.highlights).toEqual([
      {
        title: 'Guest checkout is live',
        detail: 'Rolled out to all traffic on Tuesday.',
      },
    ]);
  });

  it('propagates SCOPE_DELETED from the resolver', async () => {
    const { svc, scopeResolver } = makeService();
    scopeResolver.resolve.mockRejectedValue(
      new Error('SCOPE_DELETED: team missing'),
    );
    await expect(
      svc.generate({
        organizationId: 'o1',
        scope: { type: 'team', teamId: 't1' },
        period,
        timezone: 'UTC',
        commitClock: 'committed',
      }),
    ).rejects.toThrow(/SCOPE_DELETED/);
  });
});
