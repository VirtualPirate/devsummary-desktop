import type { ConfigService } from '@nestjs/config';

export interface SlackConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

const DEFAULT_SCOPES = [
  'chat:write',
  'channels:read',
  'groups:read',
  'users:read',
  'channels:join',
];

export function loadSlackConfig(
  configService: ConfigService,
): SlackConfig | null {
  const clientId = configService.get<string>('SLACK_CLIENT_ID');
  const clientSecret = configService.get<string>('SLACK_CLIENT_SECRET');
  const redirectUri = configService.get<string>('SLACK_REDIRECT_URI');

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  const scopesRaw = configService.get<string>('SLACK_SCOPES');
  const scopes = scopesRaw
    ? scopesRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : DEFAULT_SCOPES;

  return { clientId, clientSecret, redirectUri, scopes };
}
