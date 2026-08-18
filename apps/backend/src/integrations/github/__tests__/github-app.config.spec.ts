import { loadGithubAppConfig } from '../github-app.config';

function configService(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key],
  } as unknown as import('@nestjs/config').ConfigService;
}

describe('loadGithubAppConfig', () => {
  it('returns null when any required var is missing', () => {
    expect(
      loadGithubAppConfig(
        configService({
          GITHUB_APP_ID: '12345',
          GITHUB_APP_SLUG: 'gitbrief',
          // GITHUB_APP_PRIVATE_KEY missing
          GITHUB_WEBHOOK_SECRET: 'whatever',
        }),
      ),
    ).toBeNull();
  });

  it('returns a parsed config when all required vars are present', () => {
    const cfg = loadGithubAppConfig(
      configService({
        GITHUB_APP_ID: '12345',
        GITHUB_APP_SLUG: 'gitbrief',
        GITHUB_APP_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----',
        GITHUB_WEBHOOK_SECRET: 's3cret',
      }),
    );

    expect(cfg).toMatchObject({
      appId: '12345',
      slug: 'gitbrief',
      webhookSecret: 's3cret',
    });
    expect(cfg!.privateKey).toContain('BEGIN PRIVATE KEY');
  });

  it('base64-decodes the private key when it is base64 PEM', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----';
    const cfg = loadGithubAppConfig(
      configService({
        GITHUB_APP_ID: '1',
        GITHUB_APP_SLUG: 's',
        GITHUB_APP_PRIVATE_KEY: Buffer.from(pem).toString('base64'),
        GITHUB_WEBHOOK_SECRET: 'w',
      }),
    );
    expect(cfg!.privateKey).toBe(pem);
  });

  it('exposes optional client id/secret when present', () => {
    const cfg = loadGithubAppConfig(
      configService({
        GITHUB_APP_ID: '1',
        GITHUB_APP_SLUG: 's',
        GITHUB_APP_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----',
        GITHUB_WEBHOOK_SECRET: 'w',
        GITHUB_APP_CLIENT_ID: 'cid',
        GITHUB_APP_CLIENT_SECRET: 'csec',
      }),
    );
    expect(cfg).toMatchObject({ clientId: 'cid', clientSecret: 'csec' });
  });
});
