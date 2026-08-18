import type { ConfigService } from '@nestjs/config';

export interface GithubAppConfig {
  appId: string;
  slug: string;
  privateKey: string;
  webhookSecret: string;
  clientId?: string;
  clientSecret?: string;
}

const PEM_HEADER = '-----BEGIN';

function decodePrivateKey(raw: string): string {
  if (raw.includes(PEM_HEADER)) {
    return raw.replace(/\\n/g, '\n');
  }

  return Buffer.from(raw, 'base64').toString('utf8');
}

export function loadGithubAppConfig(
  configService: ConfigService,
): GithubAppConfig | null {
  const appId = configService.get<string>('GITHUB_APP_ID');
  const slug = configService.get<string>('GITHUB_APP_SLUG');
  const rawKey = configService.get<string>('GITHUB_APP_PRIVATE_KEY');
  const webhookSecret = configService.get<string>('GITHUB_WEBHOOK_SECRET');

  if (!appId || !slug || !rawKey || !webhookSecret) {
    return null;
  }

  return {
    appId,
    slug,
    privateKey: decodePrivateKey(rawKey),
    webhookSecret,
    clientId: configService.get<string>('GITHUB_APP_CLIENT_ID') || undefined,
    clientSecret:
      configService.get<string>('GITHUB_APP_CLIENT_SECRET') || undefined,
  };
}
