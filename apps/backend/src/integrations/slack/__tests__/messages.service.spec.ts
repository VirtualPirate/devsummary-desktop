import { SlackMessagesService } from '../services/messages.service';

function makeService() {
  const installsRepo = {
    findActiveByOrganizationId: jest.fn(),
  } as any;
  const client = {
    postMessage: jest.fn(),
    getChannels: jest.fn(),
    getMembers: jest.fn(),
    joinChannel: jest.fn(),
  } as any;
  const svc = new SlackMessagesService(installsRepo, client);
  return { svc, installsRepo, client };
}

const installation = {
  id: 'i1',
  organizationId: 'o1',
  accessToken: 'xoxb-tok',
  raw: { teamId: 'T1' } as any,
};

describe('SlackMessagesService', () => {
  describe('postMessage', () => {
    it('posts via client with stored token and returns ts', async () => {
      const { svc, installsRepo, client } = makeService();
      installsRepo.findActiveByOrganizationId.mockResolvedValue(installation);
      client.postMessage.mockResolvedValue({ ok: true, ts: '12345.6' });

      const res = await svc.postMessage('o1', 'C1', 'hello');

      expect(client.postMessage).toHaveBeenCalledWith(
        'xoxb-tok',
        'C1',
        'hello',
        undefined,
      );
      expect(res).toEqual({ success: true, ts: '12345.6' });
    });

    it('passes blocks through to the client', async () => {
      const { svc, installsRepo, client } = makeService();
      installsRepo.findActiveByOrganizationId.mockResolvedValue(installation);
      client.postMessage.mockResolvedValue({ ok: true, ts: '12345.6' });
      const blocks = [{ type: 'divider' }];

      await svc.postMessage('o1', 'C1', 'hello', blocks);

      expect(client.postMessage).toHaveBeenCalledWith(
        'xoxb-tok',
        'C1',
        'hello',
        blocks,
      );
    });

    it('throws SLACK_INSTALLATION_NOT_FOUND when org has no installation', async () => {
      const { svc, installsRepo } = makeService();
      installsRepo.findActiveByOrganizationId.mockResolvedValue(null);

      await expect(svc.postMessage('o1', 'C1', 'hi')).rejects.toMatchObject({
        code: 'SLACK_INSTALLATION_NOT_FOUND',
      });
    });
  });

  describe('listChannels', () => {
    it('maps the Slack shape, drops archived, and sorts by name', async () => {
      const { svc, installsRepo, client } = makeService();
      installsRepo.findActiveByOrganizationId.mockResolvedValue(installation);
      client.getChannels.mockResolvedValue([
        { id: 'C2', name: 'general', is_member: true, num_members: 128 },
        { id: 'C3', name: 'old-launch', is_archived: true, is_member: true },
        { id: 'C1', name: 'engineering', is_private: true, is_member: false },
      ]);

      const out = await svc.listChannels('o1');

      expect(client.getChannels).toHaveBeenCalledWith('xoxb-tok');
      expect(out).toEqual([
        {
          id: 'C1',
          name: 'engineering',
          isPrivate: true,
          isMember: false,
          memberCount: null,
        },
        {
          id: 'C2',
          name: 'general',
          isPrivate: false,
          isMember: true,
          memberCount: 128,
        },
      ]);
    });

    it('throws when no installation exists', async () => {
      const { svc, installsRepo } = makeService();
      installsRepo.findActiveByOrganizationId.mockResolvedValue(null);

      await expect(svc.listChannels('o1')).rejects.toMatchObject({
        code: 'SLACK_INSTALLATION_NOT_FOUND',
      });
    });
  });

  describe('joinChannel', () => {
    it('joins a public channel through the client', async () => {
      const { svc, installsRepo, client } = makeService();
      installsRepo.findActiveByOrganizationId.mockResolvedValue(installation);
      client.getChannels.mockResolvedValue([
        { id: 'C1', name: 'launch-updates', is_member: false },
      ]);

      await svc.joinChannel('o1', 'C1');

      expect(client.joinChannel).toHaveBeenCalledWith('xoxb-tok', 'C1');
    });

    // No token can join a private channel — attempting it returns a Slack error
    // the user cannot act on, so the refusal has to name the real fix.
    it('refuses a private channel without calling Slack', async () => {
      const { svc, installsRepo, client } = makeService();
      installsRepo.findActiveByOrganizationId.mockResolvedValue(installation);
      client.getChannels.mockResolvedValue([
        { id: 'C9', name: 'ops-alerts', is_private: true, is_member: false },
      ]);

      await expect(svc.joinChannel('o1', 'C9')).rejects.toMatchObject({
        code: 'SLACK_API_FAILED',
      });
      expect(client.joinChannel).not.toHaveBeenCalled();
    });
  });

  describe('listMembers', () => {
    it('returns members from the client', async () => {
      const { svc, installsRepo, client } = makeService();
      installsRepo.findActiveByOrganizationId.mockResolvedValue(installation);
      client.getMembers.mockResolvedValue([{ id: 'U1' }]);

      const out = await svc.listMembers('o1');
      expect(client.getMembers).toHaveBeenCalledWith('xoxb-tok');
      expect(out).toEqual([{ id: 'U1' }]);
    });
  });
});
