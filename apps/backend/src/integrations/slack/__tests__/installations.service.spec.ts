import { SlackInstallationsService } from '../services/installations.service';

const AUTH_TEST = {
  ok: true,
  team: 'Acme',
  team_id: 'T1',
  user_id: 'U-bot',
  response_metadata: { scopes: ['chat:write', 'channels:read'] },
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    organizationId: 'org-1',
    accessToken: 'xoxb-abc',
    teamId: 'T1',
    raw: {
      teamId: 'T1',
      teamName: 'Acme',
      botUserId: 'U-bot',
      appId: '',
      scope: 'chat:write,channels:read',
      oauthResponse: AUTH_TEST,
    },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeService() {
  const installs = {
    findById: jest.fn(),
    findActiveByOrganizationId: jest.fn(),
    findByOrganizationIdIncludingDeleted: jest.fn().mockResolvedValue(null),
    findByIdScopedToOrg: jest.fn(),
    existsOtherActiveByTeamId: jest.fn().mockResolvedValue(false),
    create: jest.fn().mockResolvedValue(makeRow()),
    updateTokenAndRaw: jest.fn(),
    softDelete: jest.fn(),
  };
  const client = {
    authTest: jest.fn().mockResolvedValue(AUTH_TEST),
    revokeToken: jest.fn().mockResolvedValue({ ok: true }),
  };
  const db = {
    transaction: () => ({
      execute: (fn: (tx: unknown) => unknown) => Promise.resolve(fn({})),
    }),
  };
  const briefSchedules = { clearSlackConfigForInstallation: jest.fn() };
  const secrets = { update: jest.fn() };
  const svc = new SlackInstallationsService(
    installs as never,
    client as never,
    db as never,
    briefSchedules as never,
    secrets as never,
  );
  return { svc, installs, client, briefSchedules, secrets };
}

describe('SlackInstallationsService.connectToken', () => {
  it('validates the pasted token and stores a new installation', async () => {
    const { svc, installs, client } = makeService();

    const view = await svc.connectToken({
      orgId: 'org-1',
      token: 'xoxb-abc',
      userId: 'user-1',
    });

    expect(client.authTest).toHaveBeenCalledWith('xoxb-abc');
    expect(installs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        accessToken: 'xoxb-abc',
        teamId: 'T1',
        raw: expect.objectContaining({
          teamId: 'T1',
          teamName: 'Acme',
          botUserId: 'U-bot',
          scope: 'chat:write,channels:read',
          connectedByUserId: 'user-1',
        }) as unknown,
      }),
      expect.anything(),
    );
    expect(view.teamId).toBe('T1');
  });

  it('mirrors the token into the secret bundle so the keychain holds it', async () => {
    const { svc, secrets } = makeService();
    await svc.connectToken({ orgId: 'org-1', token: 'xoxb-abc', userId: null });
    expect(secrets.update).toHaveBeenCalledWith({
      SLACK_BOT_TOKEN: 'xoxb-abc',
    });
  });

  it('replaces the token on an existing row instead of refusing (rotation)', async () => {
    const { svc, installs } = makeService();
    installs.findByOrganizationIdIncludingDeleted.mockResolvedValue(makeRow());
    installs.findById.mockResolvedValue(makeRow({ accessToken: 'xoxb-new' }));

    await svc.connectToken({
      orgId: 'org-1',
      token: 'xoxb-new',
      userId: null,
    });

    expect(installs.updateTokenAndRaw).toHaveBeenCalledWith(
      'inst-1',
      expect.objectContaining({ accessToken: 'xoxb-new', teamId: 'T1' }),
      expect.anything(),
    );
    expect(installs.create).not.toHaveBeenCalled();
  });

  it('un-deletes a soft-deleted installation on re-connect', async () => {
    const { svc, installs } = makeService();
    installs.findByOrganizationIdIncludingDeleted.mockResolvedValue(
      makeRow({ deletedAt: new Date('2026-02-01T00:00:00Z') }),
    );
    installs.findById.mockResolvedValue(makeRow());

    await svc.connectToken({ orgId: 'org-1', token: 'xoxb-abc', userId: null });

    // `updateTokenAndRaw` clears deletedAt — that is the un-delete.
    expect(installs.updateTokenAndRaw).toHaveBeenCalled();
  });

  it('propagates an auth.test failure without storing anything', async () => {
    const { svc, installs, client, secrets } = makeService();
    client.authTest.mockRejectedValue(new Error('invalid_auth'));

    await expect(
      svc.connectToken({ orgId: 'org-1', token: 'xoxb-bad', userId: null }),
    ).rejects.toThrow('invalid_auth');
    expect(installs.create).not.toHaveBeenCalled();
    expect(secrets.update).not.toHaveBeenCalled();
  });

  it('refuses a token whose auth.test names no workspace', async () => {
    const { svc, installs, client } = makeService();
    client.authTest.mockResolvedValue({ ok: true });

    await expect(
      svc.connectToken({ orgId: 'org-1', token: 'xoxb-abc', userId: null }),
    ).rejects.toMatchObject({ code: 'SLACK_API_FAILED' });
    expect(installs.create).not.toHaveBeenCalled();
  });
});

describe('SlackInstallationsService.listForOrg', () => {
  it('returns the active installation without its access token', async () => {
    const { svc, installs } = makeService();
    installs.findActiveByOrganizationId.mockResolvedValue(makeRow());

    const [view] = await svc.listForOrg('org-1');

    expect(view).toMatchObject({ id: 'inst-1', teamId: 'T1' });
    expect(JSON.stringify(view)).not.toContain('xoxb-abc');
  });

  it('returns an empty array when nothing is connected', async () => {
    const { svc, installs } = makeService();
    installs.findActiveByOrganizationId.mockResolvedValue(null);
    expect(await svc.listForOrg('org-1')).toEqual([]);
  });
});

describe('SlackInstallationsService.disconnect', () => {
  it('revokes, soft-deletes, clears schedules and drops the stored token', async () => {
    const { svc, installs, client, briefSchedules, secrets } = makeService();
    installs.findByIdScopedToOrg.mockResolvedValue(makeRow());

    await svc.disconnect('org-1', 'inst-1');

    expect(client.revokeToken).toHaveBeenCalledWith('xoxb-abc');
    expect(installs.softDelete).toHaveBeenCalledWith(
      'inst-1',
      expect.anything(),
    );
    expect(briefSchedules.clearSlackConfigForInstallation).toHaveBeenCalledWith(
      'inst-1',
      expect.anything(),
    );
    expect(secrets.update).toHaveBeenCalledWith({ SLACK_BOT_TOKEN: undefined });
  });

  it('skips the revoke when another workspace still holds the same team', async () => {
    const { svc, installs, client, secrets } = makeService();
    installs.findByIdScopedToOrg.mockResolvedValue(makeRow());
    installs.existsOtherActiveByTeamId.mockResolvedValue(true);

    await svc.disconnect('org-1', 'inst-1');

    expect(client.revokeToken).not.toHaveBeenCalled();
    expect(installs.softDelete).toHaveBeenCalled();
    // The token still works for the other workspace, so it stays in the bundle.
    expect(secrets.update).not.toHaveBeenCalled();
  });

  it('still soft-deletes locally when the Slack-side revoke fails', async () => {
    const { svc, installs, client } = makeService();
    installs.findByIdScopedToOrg.mockResolvedValue(makeRow());
    client.revokeToken.mockRejectedValue(new Error('boom'));

    await svc.disconnect('org-1', 'inst-1');

    expect(installs.softDelete).toHaveBeenCalled();
  });

  it('404s if the installation is not in the org', async () => {
    const { svc, installs } = makeService();
    installs.findByIdScopedToOrg.mockResolvedValue(null);

    await expect(svc.disconnect('org-1', 'inst-1')).rejects.toMatchObject({
      code: 'SLACK_INSTALLATION_NOT_FOUND',
    });
  });
});
