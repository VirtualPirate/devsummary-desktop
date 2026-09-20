import { AgentUsageService } from '../services/agent-usage.service';
import type { AgentsConfig } from '../agents.config';

function makeService(model: string | null = 'gpt-4o') {
  const repo = {
    insert: jest.fn().mockResolvedValue({ id: 'usage-1' }),
    recordTokens: jest.fn().mockResolvedValue(undefined),
  };
  const config: AgentsConfig = {
    get llm() {
      return model ? { provider: 'openai' as const, model } : null;
    },
  };
  return { svc: new AgentUsageService(repo as never, config), repo };
}

describe('AgentUsageService', () => {
  it('records the run before the model is asked for anything', async () => {
    const { svc, repo } = makeService();
    await expect(
      svc.reserve({ organizationId: 'org-1', sessionId: 's1', userId: 'u1' }),
    ).resolves.toBe('usage-1');
    expect(repo.insert).toHaveBeenCalledWith({
      organizationId: 'org-1',
      sessionId: 's1',
      userId: 'u1',
      model: 'gpt-4o',
    });
  });

  // The cloud original capped runs per day here; a single-user install has no
  // cap, so nothing counts and nothing can refuse. Left as a test because the
  // absence is the decision — see docs/UPSTREAM-DRIFT.md §4.
  it('never refuses a run, however many have already been made', async () => {
    const { svc, repo } = makeService();
    for (let i = 0; i < 50; i += 1) {
      await svc.reserve({
        organizationId: 'org-1',
        sessionId: 's1',
        userId: 'u1',
      });
    }
    expect(repo.insert).toHaveBeenCalledTimes(50);
  });

  it('records the model name it will fail with when nothing is configured', async () => {
    const { svc, repo } = makeService(null);
    await svc.reserve({
      organizationId: 'org-1',
      sessionId: 's1',
      userId: 'u1',
    });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'unconfigured' }),
    );
  });

  it('settles token counts without failing the turn when they are absent', async () => {
    const { svc, repo } = makeService();
    await svc.settle('usage-1', { promptTokens: null, completionTokens: null });
    expect(repo.recordTokens).toHaveBeenCalledWith('usage-1', null, null);
  });
});
