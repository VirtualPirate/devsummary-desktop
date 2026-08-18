import { WebClient } from '@slack/web-api';
import { SlackClient } from '../slack.client';
import type { SlackConfig } from '../slack.config';

const cfg: SlackConfig = {
  clientId: 'cid',
  clientSecret: 'csec',
  redirectUri: 'https://app.example/cb',
  scopes: ['chat:write', 'channels:read'],
};

function latestClient(): jest.Mocked<WebClient> {
  const instances = (WebClient as unknown as { __mockInstances: WebClient[] })
    .__mockInstances;
  if (instances.length === 0) {
    throw new Error('Expected a WebClient mock instance to be created');
  }
  return instances[instances.length - 1] as unknown as jest.Mocked<WebClient>;
}

describe('SlackClient', () => {
  beforeEach(() => {
    (WebClient as unknown as { __reset: () => void }).__reset();
  });

  it('builds the auth URI with state, configured scopes, and redirect', () => {
    const c = new SlackClient(cfg);
    const url = c.generateAuthUri('state-token');

    expect(url.startsWith('https://slack.com/oauth/v2/authorize?')).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.example/cb');
    expect(u.searchParams.get('state')).toBe('state-token');
    expect(u.searchParams.get('scope')).toBe('chat:write,channels:read');
  });

  it('exchanges code for token and returns the OAuth response', async () => {
    const c = new SlackClient(cfg);
    const client = latestClient();
    (client.oauth.v2.access as jest.Mock).mockResolvedValue({
      ok: true,
      access_token: 'xoxb-abc',
      team: { id: 'T1', name: 'team' },
      bot_user_id: 'U1',
      app_id: 'A1',
      scope: 'chat:write',
      authed_user: { id: 'U99' },
    });

    const res = await c.exchangeCodeForToken('code-xyz');

    expect(client.oauth.v2.access).toHaveBeenCalledWith({
      client_id: 'cid',
      client_secret: 'csec',
      code: 'code-xyz',
      redirect_uri: 'https://app.example/cb',
    });
    expect(res.access_token).toBe('xoxb-abc');
  });

  it('throws SLACK_OAUTH_EXCHANGE_FAILED when Slack returns !ok', async () => {
    const c = new SlackClient(cfg);
    const client = latestClient();
    (client.oauth.v2.access as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'invalid_code',
    });

    await expect(c.exchangeCodeForToken('bad')).rejects.toMatchObject({
      code: 'SLACK_OAUTH_EXCHANGE_FAILED',
      status: 502,
    });
  });

  it('posts a message via chat.postMessage with the supplied token', async () => {
    const c = new SlackClient(cfg);
    const client = latestClient();
    (client.chat.postMessage as jest.Mock).mockResolvedValue({
      ok: true,
      ts: '12345.6789',
    });

    const res = await c.postMessage('xoxb-token', 'C1', 'hello');

    expect(client.chat.postMessage).toHaveBeenCalledWith({
      token: 'xoxb-token',
      channel: 'C1',
      text: 'hello',
      blocks: undefined,
    });
    expect(res.ts).toBe('12345.6789');
  });

  it('wraps WebClient errors as SLACK_API_FAILED', async () => {
    const c = new SlackClient(cfg);
    const client = latestClient();
    (client.chat.postMessage as jest.Mock).mockRejectedValue(
      new Error('network boom'),
    );

    await expect(c.postMessage('t', 'C1', 'x')).rejects.toMatchObject({
      code: 'SLACK_API_FAILED',
      status: 502,
    });
  });

  it('paginates conversations.list through next_cursor', async () => {
    const c = new SlackClient(cfg);
    const client = latestClient();
    (client.conversations.list as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        channels: [{ id: 'C1', name: 'general' }],
        response_metadata: { next_cursor: 'cur-2' },
      })
      .mockResolvedValueOnce({
        ok: true,
        channels: [{ id: 'C2', name: 'random' }],
        response_metadata: { next_cursor: '' },
      });

    const out = await c.getChannels('xoxb-token');

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'C1' });
    expect(out[1]).toMatchObject({ id: 'C2' });
    expect(
      (client.conversations.list as jest.Mock).mock.calls[1][0],
    ).toMatchObject({ cursor: 'cur-2' });
  });

  it('paginates users.list through next_cursor', async () => {
    const c = new SlackClient(cfg);
    const client = latestClient();
    (client.users.list as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        members: [{ id: 'U1' }],
        response_metadata: { next_cursor: 'cur-2' },
      })
      .mockResolvedValueOnce({
        ok: true,
        members: [{ id: 'U2' }],
        response_metadata: { next_cursor: '' },
      });

    const out = await c.getMembers('xoxb-token');
    expect(out.map((m: { id?: string }) => m.id)).toEqual(['U1', 'U2']);
  });

  it('revokes a token via auth.revoke', async () => {
    const c = new SlackClient(cfg);
    const client = latestClient();
    (client.auth.revoke as jest.Mock).mockResolvedValue({ ok: true });

    await c.revokeToken('xoxb-abc');

    expect(client.auth.revoke).toHaveBeenCalledWith({ token: 'xoxb-abc' });
  });
});
