import { SlackInstallationsService } from '../services/installations.service';

function makeMocks() {
  const installsRepo = {
    findById: jest.fn(),
    findActiveByOrganizationId: jest.fn(),
    findByOrganizationIdIncludingDeleted: jest.fn(),
    findByIdScopedToOrg: jest.fn(),
    existsOtherActiveByTeamId: jest.fn().mockResolvedValue(false),
    create: jest.fn(),
    updateTokenAndRaw: jest.fn(),
    softDelete: jest.fn(),
    undelete: jest.fn(),
  } as any;

  const stateToken = {
    sign: jest.fn(() => 'signed-token'),
    verify: jest.fn(),
  } as any;

  const client = {
    generateAuthUri: jest.fn(
      (state: string) => `https://slack.com/oauth/v2/authorize?state=${state}`,
    ),
    exchangeCodeForToken: jest.fn(),
    revokeToken: jest.fn(),
  } as any;

  const config = {
    clientId: 'cid',
    clientSecret: 'csec',
    redirectUri: 'https://app.example/cb',
    scopes: ['chat:write'],
  };

  const db = {
    transaction: jest.fn(() => ({
      execute: (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true }),
    })),
  } as any;

  const briefSchedulesRepo = {
    clearSlackConfigForInstallation: jest.fn(),
  } as any;

  return { installsRepo, stateToken, client, config, db, briefSchedulesRepo };
}

function makeService(overrides: Partial<ReturnType<typeof makeMocks>> = {}) {
  const m = { ...makeMocks(), ...overrides };
  return {
    svc: new SlackInstallationsService(
      m.installsRepo,
      m.stateToken,
      m.client,
      m.config,
      m.db,
      m.briefSchedulesRepo,
    ),
    mocks: m,
  };
}

function makeOauthResponse() {
  return {
    ok: true,
    access_token: 'xoxb-abc',
    team: { id: 'T1', name: 'team' },
    bot_user_id: 'B1',
    app_id: 'A1',
    scope: 'chat:write,channels:read',
    authed_user: { id: 'U99' },
  };
}

describe('SlackInstallationsService', () => {
  describe('buildInstallUrl', () => {
    it('throws when config is null', () => {
      const { svc } = makeService({ config: null as any });
      expect(() => svc.buildInstallUrl({ orgId: 'o', userId: 'u' })).toThrow(
        /not configured/i,
      );
    });

    it('returns Slack install url with signed state', () => {
      const { svc, mocks } = makeService();
      const url = svc.buildInstallUrl({ orgId: 'o1', userId: 'u1' });

      expect(mocks.stateToken.sign).toHaveBeenCalledWith({
        orgId: 'o1',
        userId: 'u1',
      });
      expect(mocks.client.generateAuthUri).toHaveBeenCalledWith('signed-token');
      expect(url).toBe(
        'https://slack.com/oauth/v2/authorize?state=signed-token',
      );
    });
  });

  describe('handleCallback', () => {
    it('inserts a new installation when none exists for the org', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({ orgId: 'o1', userId: 'u1' });
      mocks.installsRepo.findByOrganizationIdIncludingDeleted.mockResolvedValue(
        null,
      );
      mocks.client.exchangeCodeForToken.mockResolvedValue(makeOauthResponse());
      mocks.installsRepo.create.mockResolvedValue({ id: 'inst-uuid' });

      const result = await svc.handleCallback({
        state: 't',
        code: 'code-x',
        sessionUserId: 'u1',
      });

      expect(mocks.installsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'o1',
          accessToken: 'xoxb-abc',
          teamId: 'T1',
          raw: expect.objectContaining({
            teamId: 'T1',
            teamName: 'team',
            botUserId: 'B1',
            appId: 'A1',
            scope: 'chat:write,channels:read',
            authedUserId: 'U99',
            connectedByUserId: 'u1',
          }),
        }),
        expect.anything(),
      );
      expect(result).toEqual({ orgId: 'o1' });
    });

    it('un-deletes a soft-deleted installation on re-install', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({ orgId: 'o1', userId: 'u1' });
      mocks.installsRepo.findByOrganizationIdIncludingDeleted.mockResolvedValue(
        {
          id: 'existing-uuid',
          organizationId: 'o1',
          deletedAt: new Date('2026-05-10T00:00:00Z'),
        },
      );
      mocks.client.exchangeCodeForToken.mockResolvedValue(makeOauthResponse());

      await svc.handleCallback({
        state: 't',
        code: 'code-x',
        sessionUserId: 'u1',
      });

      expect(mocks.installsRepo.updateTokenAndRaw).toHaveBeenCalledWith(
        'existing-uuid',
        {
          accessToken: 'xoxb-abc',
          teamId: 'T1',
          raw: expect.objectContaining({ teamId: 'T1' }),
        },
        expect.anything(),
      );
      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
    });

    it('rejects when an active installation already exists for the org', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({ orgId: 'o1', userId: 'u1' });
      mocks.installsRepo.findByOrganizationIdIncludingDeleted.mockResolvedValue(
        {
          id: 'existing-uuid',
          organizationId: 'o1',
          deletedAt: null,
        },
      );
      mocks.client.exchangeCodeForToken.mockResolvedValue(makeOauthResponse());

      await expect(
        svc.handleCallback({ state: 't', code: 'code-x', sessionUserId: 'u1' }),
      ).rejects.toMatchObject({ code: 'SLACK_ORG_ALREADY_CONNECTED' });

      expect(mocks.installsRepo.create).not.toHaveBeenCalled();
      expect(mocks.installsRepo.updateTokenAndRaw).not.toHaveBeenCalled();
    });

    it('rejects when state user does not match session user', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({
        orgId: 'o1',
        userId: 'someone-else',
      });

      await expect(
        svc.handleCallback({ state: 't', code: 'c', sessionUserId: 'u1' }),
      ).rejects.toMatchObject({ code: 'SLACK_STATE_USER_MISMATCH' });
    });

    it('rejects when state is invalid', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockImplementation(() => {
        throw new Error('bad state');
      });

      await expect(
        svc.handleCallback({ state: 'nope', code: 'c', sessionUserId: null }),
      ).rejects.toMatchObject({ code: 'SLACK_STATE_INVALID' });
    });

    it('rejects when code is missing', async () => {
      const { svc, mocks } = makeService();
      mocks.stateToken.verify.mockReturnValue({ orgId: 'o1', userId: 'u1' });

      await expect(
        svc.handleCallback({
          state: 't',
          code: undefined,
          sessionUserId: 'u1',
        }),
      ).rejects.toMatchObject({ code: 'SLACK_STATE_INVALID' });
    });
  });

  describe('listForOrg', () => {
    it('returns active installation row without access_token', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findActiveByOrganizationId.mockResolvedValue({
        id: 'i1',
        organizationId: 'o1',
        accessToken: 'xoxb-secret',
        raw: {
          teamId: 'T1',
          teamName: 'team',
          botUserId: 'B1',
          appId: 'A1',
          scope: 'chat:write',
          oauthResponse: {},
        },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
        deletedAt: null,
      });

      const list = await svc.listForOrg('o1');
      expect(list).toHaveLength(1);
      expect(list[0]).not.toHaveProperty('accessToken');
      expect(list[0]).toMatchObject({
        id: 'i1',
        teamId: 'T1',
        teamName: 'team',
      });
    });

    it('returns an empty array when no installation exists', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findActiveByOrganizationId.mockResolvedValue(null);

      expect(await svc.listForOrg('o1')).toEqual([]);
    });
  });

  describe('disconnect', () => {
    it('revokes the token and soft-deletes the row when this org is the only holder', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue({
        id: 'inst-uuid',
        accessToken: 'xoxb-abc',
        teamId: 'T1',
      });

      await svc.disconnect('o1', 'inst-uuid');

      expect(mocks.installsRepo.existsOtherActiveByTeamId).toHaveBeenCalledWith(
        'T1',
        'inst-uuid',
      );
      expect(mocks.client.revokeToken).toHaveBeenCalledWith('xoxb-abc');
      expect(mocks.installsRepo.softDelete).toHaveBeenCalledWith(
        'inst-uuid',
        expect.anything(),
      );
    });

    it('skips the revoke but still soft-deletes when another active org shares the workspace', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue({
        id: 'inst-uuid',
        accessToken: 'xoxb-abc',
        teamId: 'T1',
      });
      mocks.installsRepo.existsOtherActiveByTeamId.mockResolvedValue(true);

      await svc.disconnect('o1', 'inst-uuid');

      expect(mocks.client.revokeToken).not.toHaveBeenCalled();
      expect(mocks.installsRepo.softDelete).toHaveBeenCalledWith(
        'inst-uuid',
        expect.anything(),
      );
    });

    it('skips the revoke when team_id is unknown (pre-backfill row)', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue({
        id: 'inst-uuid',
        accessToken: 'xoxb-abc',
        teamId: null,
      });

      await svc.disconnect('o1', 'inst-uuid');

      expect(
        mocks.installsRepo.existsOtherActiveByTeamId,
      ).not.toHaveBeenCalled();
      expect(mocks.client.revokeToken).not.toHaveBeenCalled();
      expect(mocks.installsRepo.softDelete).toHaveBeenCalledWith(
        'inst-uuid',
        expect.anything(),
      );
    });

    it('still soft-deletes locally when Slack-side revoke fails', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue({
        id: 'inst-uuid',
        accessToken: 'xoxb-abc',
        teamId: 'T1',
      });
      mocks.client.revokeToken.mockRejectedValue(new Error('boom'));

      await svc.disconnect('o1', 'inst-uuid');

      expect(mocks.installsRepo.softDelete).toHaveBeenCalled();
    });

    it('clears dependent brief-schedule Slack config in the same transaction', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue({
        id: 'inst-uuid',
        accessToken: 'xoxb-abc',
        teamId: 'T1',
      });

      await svc.disconnect('o1', 'inst-uuid');

      const tx = mocks.installsRepo.softDelete.mock.calls[0][1];
      expect(
        mocks.briefSchedulesRepo.clearSlackConfigForInstallation,
      ).toHaveBeenCalledWith('inst-uuid', tx);
    });

    it('404s if the installation is not in the org', async () => {
      const { svc, mocks } = makeService();
      mocks.installsRepo.findByIdScopedToOrg.mockResolvedValue(null);

      await expect(svc.disconnect('o1', 'inst-uuid')).rejects.toMatchObject({
        code: 'SLACK_INSTALLATION_NOT_FOUND',
      });
    });
  });
});
