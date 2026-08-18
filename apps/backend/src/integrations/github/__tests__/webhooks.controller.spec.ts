import { GithubWebhooksController } from '../controllers/webhooks.controller';
import { WORKFLOW } from '../../../temporal';

function makeMocks() {
  return {
    verifier: { verify: jest.fn() } as any,
    webhookEvents: {
      create: jest.fn(async () => undefined),
      markProcessed: jest.fn(async () => undefined),
    } as any,
    reposRepo: {
      findByGithubRepoId: jest.fn(async () => null as any),
    } as any,
    installationsRepo: {
      findById: jest.fn(async () => ({ organizationId: 'org-1' }) as any),
    } as any,
    temporal: {
      start: jest.fn(async () => 'wf-id'),
      startDeduped: jest.fn(async () => 'wf-id'),
    } as any,
    config: { webhookSecret: 'secret' } as any,
  };
}

function makeController(overrides: Partial<ReturnType<typeof makeMocks>> = {}) {
  const m = { ...makeMocks(), ...overrides };
  return {
    ctrl: new GithubWebhooksController(
      m.verifier,
      m.webhookEvents,
      m.reposRepo,
      m.installationsRepo,
      m.temporal,
      m.config,
    ),
    mocks: m,
  };
}

const req = (parsed: Record<string, unknown>) =>
  ({
    rawBody: Buffer.from(JSON.stringify(parsed)),
    body: parsed,
  }) as any;

describe('GithubWebhooksController', () => {
  it('writes outbox row and dispatches sync job for member.added on a tracked repo', async () => {
    const { ctrl, mocks } = makeController();
    mocks.reposRepo.findByGithubRepoId.mockResolvedValueOnce({
      id: 'r1',
      installationId: 'inst-1',
      deletedAt: null,
    });

    await ctrl.handle(
      req({ action: 'added', repository: { id: 42 } }),
      'sig',
      'member',
      'd-1',
    );

    expect(mocks.webhookEvents.create).toHaveBeenCalled();
    expect(mocks.installationsRepo.findById).toHaveBeenCalledWith('inst-1');
    expect(mocks.temporal.start).toHaveBeenCalledWith(
      WORKFLOW.syncRepoCollaborators,
      expect.objectContaining({
        args: [
          {
            repositoryId: 'r1',
            trigger: 'webhook',
            organizationId: 'org-1',
          },
        ],
      }),
    );
    expect(mocks.webhookEvents.markProcessed).toHaveBeenCalledWith('d-1');
  });

  it('does not dispatch for non-member events', async () => {
    const { ctrl, mocks } = makeController();

    await ctrl.handle(
      req({ action: 'opened', repository: { id: 42 } }),
      'sig',
      'pull_request',
      'd-2',
    );

    expect(mocks.temporal.start).not.toHaveBeenCalled();
    expect(mocks.webhookEvents.markProcessed).toHaveBeenCalledWith('d-2');
  });

  it('does not dispatch for unknown member actions', async () => {
    const { ctrl, mocks } = makeController();
    mocks.reposRepo.findByGithubRepoId.mockResolvedValueOnce({
      id: 'r1',
      installationId: 'inst-1',
      deletedAt: null,
    });

    await ctrl.handle(
      req({ action: 'unknown', repository: { id: 42 } }),
      'sig',
      'member',
      'd-3',
    );

    expect(mocks.temporal.start).not.toHaveBeenCalled();
    expect(mocks.webhookEvents.markProcessed).toHaveBeenCalledWith('d-3');
  });

  // Nothing re-processes `github.webhook_events`, so a row left `pending` is a
  // permanent silent drop — every path below has to mark the delivery terminal.
  it('does not dispatch for untracked repos but still marks the event processed', async () => {
    const { ctrl, mocks } = makeController();
    mocks.reposRepo.findByGithubRepoId.mockResolvedValueOnce(null);

    const res = await ctrl.handle(
      req({ action: 'added', repository: { id: 999 } }),
      'sig',
      'member',
      'd-4',
    );

    expect(mocks.temporal.start).not.toHaveBeenCalled();
    expect(mocks.webhookEvents.markProcessed).toHaveBeenCalledWith('d-4');
    expect(res).toEqual({ ok: true });
  });

  it('does not dispatch when the tracked repo is soft-deleted but still marks the event processed', async () => {
    const { ctrl, mocks } = makeController();
    mocks.reposRepo.findByGithubRepoId.mockResolvedValueOnce({
      id: 'r1',
      installationId: 'inst-1',
      deletedAt: new Date(),
    });

    await ctrl.handle(
      req({ action: 'added', repository: { id: 42 } }),
      'sig',
      'member',
      'd-5',
    );

    expect(mocks.temporal.start).not.toHaveBeenCalled();
    expect(mocks.webhookEvents.markProcessed).toHaveBeenCalledWith('d-5');
  });

  it('dispatches a push ingest for a tracked repo, deduped on the head sha', async () => {
    const { ctrl, mocks } = makeController();
    mocks.reposRepo.findByGithubRepoId.mockResolvedValueOnce({
      id: 'r1',
      installationId: 'inst-1',
      deletedAt: null,
    });

    await ctrl.handle(
      req({
        ref: 'refs/heads/main',
        repository: { id: 42 },
        commits: [
          { id: 'c1', timestamp: '2026-08-14T10:00:00Z' },
          { id: 'c2', timestamp: '2026-08-14T11:00:00Z' },
        ],
        head_commit: { id: 'c2', timestamp: '2026-08-14T11:00:00Z' },
      }),
      'sig',
      'push',
      'd-7',
    );

    expect(mocks.temporal.startDeduped).toHaveBeenCalledWith(
      WORKFLOW.ingestNewCommits,
      expect.objectContaining({
        workflowId: 'push:r1:main:c2',
        args: [
          {
            repositoryId: 'r1',
            branch: 'main',
            trigger: 'push',
            runKey: 'c2',
            shas: ['c1', 'c2'],
            truncated: false,
            earliestPushedISO: '2026-08-14T10:00:00.000Z',
            organizationId: 'org-1',
          },
        ],
      }),
    );
    expect(mocks.webhookEvents.markProcessed).toHaveBeenCalledWith('d-7');
  });

  it('does not dispatch for a tag push but still marks the event processed', async () => {
    const { ctrl, mocks } = makeController();

    await ctrl.handle(
      req({
        ref: 'refs/tags/v1.0.0',
        repository: { id: 42 },
        commits: [{ id: 'c1', timestamp: '2026-08-14T10:00:00Z' }],
      }),
      'sig',
      'push',
      'd-8',
    );

    expect(mocks.temporal.startDeduped).not.toHaveBeenCalled();
    // Not routed either — an ignored push must not cost a repository lookup.
    expect(mocks.reposRepo.findByGithubRepoId).not.toHaveBeenCalled();
    expect(mocks.webhookEvents.markProcessed).toHaveBeenCalledWith('d-8');
  });

  it('does not dispatch a push for an untracked repo', async () => {
    const { ctrl, mocks } = makeController();
    mocks.reposRepo.findByGithubRepoId.mockResolvedValueOnce(null);

    await ctrl.handle(
      req({
        ref: 'refs/heads/main',
        repository: { id: 999 },
        commits: [{ id: 'c1', timestamp: '2026-08-14T10:00:00Z' }],
        head_commit: { id: 'c1', timestamp: '2026-08-14T10:00:00Z' },
      }),
      'sig',
      'push',
      'd-9',
    );

    expect(mocks.temporal.startDeduped).not.toHaveBeenCalled();
    expect(mocks.webhookEvents.markProcessed).toHaveBeenCalledWith('d-9');
  });

  // A start with no OrganizationId still mutates org-scoped rows but is invisible
  // in every org's background-jobs toast; refuse it rather than dropping the key.
  it('refuses to start a workflow when the installation has no organization', async () => {
    const { ctrl, mocks } = makeController();
    mocks.reposRepo.findByGithubRepoId.mockResolvedValueOnce({
      id: 'r1',
      installationId: 'inst-1',
      deletedAt: null,
    });
    mocks.installationsRepo.findById.mockResolvedValueOnce(null);

    const res = await ctrl.handle(
      req({ action: 'added', repository: { id: 42 } }),
      'sig',
      'member',
      'd-6',
    );

    expect(mocks.temporal.start).not.toHaveBeenCalled();
    expect(mocks.webhookEvents.markProcessed).toHaveBeenCalledWith('d-6');
    expect(res).toEqual({ ok: true });
  });
});
