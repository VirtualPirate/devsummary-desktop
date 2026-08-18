import { loadSlackConfig } from '../slack.config';

function configService(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key],
  } as unknown as import('@nestjs/config').ConfigService;
}

describe('loadSlackConfig', () => {
  it('returns null when any required var is missing', () => {
    expect(
      loadSlackConfig(
        configService({
          SLACK_CLIENT_ID: 'cid',
          SLACK_CLIENT_SECRET: 'csec',
          // SLACK_REDIRECT_URI missing
        }),
      ),
    ).toBeNull();
  });

  it('returns a parsed config when all required vars are present', () => {
    const cfg = loadSlackConfig(
      configService({
        SLACK_CLIENT_ID: 'cid',
        SLACK_CLIENT_SECRET: 'csec',
        SLACK_REDIRECT_URI: 'https://app.example/cb',
      }),
    );

    expect(cfg).toMatchObject({
      clientId: 'cid',
      clientSecret: 'csec',
      redirectUri: 'https://app.example/cb',
    });
    expect(cfg!.scopes).toEqual([
      'chat:write',
      'channels:read',
      'groups:read',
      'users:read',
      'channels:join',
    ]);
  });

  it('parses SLACK_SCOPES override (comma-separated, trimmed)', () => {
    const cfg = loadSlackConfig(
      configService({
        SLACK_CLIENT_ID: 'cid',
        SLACK_CLIENT_SECRET: 'csec',
        SLACK_REDIRECT_URI: 'https://app.example/cb',
        SLACK_SCOPES: 'chat:write,  users:read ',
      }),
    );
    expect(cfg!.scopes).toEqual(['chat:write', 'users:read']);
  });
});
