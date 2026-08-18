import {
  LogLevel,
  WebClient,
  type AuthRevokeResponse,
  type ChatPostMessageResponse,
  type ConversationsJoinResponse,
  type ConversationsListResponse,
  type OauthV2AccessResponse,
  type UsersListResponse,
} from '@slack/web-api';
import { AppError } from '../../common/errors';
import type { SlackConfig } from './slack.config';

export type SlackBlock = Record<string, unknown>;

type Channel = NonNullable<ConversationsListResponse['channels']>[number];
type Member = NonNullable<UsersListResponse['members']>[number];

export class SlackClient {
  private readonly webClient: WebClient;

  constructor(private readonly config: SlackConfig) {
    this.webClient = new WebClient(undefined, { logLevel: LogLevel.WARN });
  }

  generateAuthUri(state: string, scopes?: string[]): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      scope: (scopes ?? this.config.scopes).join(','),
      redirect_uri: this.config.redirectUri,
      state,
    });
    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  async exchangeCodeForToken(code: string): Promise<OauthV2AccessResponse> {
    let response: OauthV2AccessResponse;
    try {
      response = await this.webClient.oauth.v2.access({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
      });
    } catch (err) {
      throw AppError.SLACK_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
    if (!response.ok) {
      throw AppError.SLACK_OAUTH_EXCHANGE_FAILED({
        reason: response.error ?? 'unknown',
      });
    }
    return response;
  }

  async revokeToken(accessToken: string): Promise<AuthRevokeResponse> {
    try {
      const res = await this.webClient.auth.revoke({ token: accessToken });
      if (!res.ok) {
        throw AppError.SLACK_API_FAILED({
          reason: res.error ?? 'revoke failed',
        });
      }
      return res;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) {
        throw err;
      }
      throw AppError.SLACK_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  async postMessage(
    accessToken: string,
    channel: string,
    text: string,
    blocks?: SlackBlock[],
  ): Promise<ChatPostMessageResponse> {
    try {
      const res = await this.webClient.chat.postMessage({
        token: accessToken,
        channel,
        text,

        blocks: blocks as any,
      });
      if (!res.ok) {
        throw AppError.SLACK_API_FAILED({
          reason: res.error ?? 'postMessage failed',
        });
      }
      return res;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) throw err;
      throw AppError.SLACK_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  /**
   * `chat.postMessage` does not join, so a public channel the bot is not in
   * answers `not_in_channel` and the brief fails long after the schedule was
   * saved. Private channels cannot be joined with a token at all — Slack
   * requires an `/invite` from a member — so that case is refused upstream
   * rather than sent here to fail.
   */
  async joinChannel(
    accessToken: string,
    channelId: string,
  ): Promise<ConversationsJoinResponse> {
    try {
      const res = await this.webClient.conversations.join({
        token: accessToken,
        channel: channelId,
      });
      if (!res.ok) {
        throw AppError.SLACK_API_FAILED({ reason: res.error ?? 'join failed' });
      }
      return res;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) throw err;
      throw AppError.SLACK_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  async getChannels(
    accessToken: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<Channel[]> {
    const channels: Channel[] = [];
    let cursor: string | undefined = opts?.cursor;
    try {
      do {
        const res: ConversationsListResponse =
          await this.webClient.conversations.list({
            token: accessToken,
            limit: opts?.limit ?? 100,
            cursor,
            // Defaults to public channels only. A brief posted to a private
            // channel is a normal setup, and `groups:read` is already in the
            // requested scopes, so asking for both is what makes the picker
            // match what the workspace actually has.
            types: 'public_channel,private_channel',
          });
        if (!res.ok) {
          throw AppError.SLACK_API_FAILED({
            reason: res.error ?? 'list failed',
          });
        }
        channels.push(...(res.channels ?? []));
        cursor = res.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return channels;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) throw err;
      throw AppError.SLACK_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  async getMembers(
    accessToken: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<Member[]> {
    const members: Member[] = [];
    let cursor: string | undefined = opts?.cursor;
    try {
      do {
        const res: UsersListResponse = await this.webClient.users.list({
          token: accessToken,
          limit: opts?.limit ?? 200,
          cursor,
        });
        if (!res.ok) {
          throw AppError.SLACK_API_FAILED({
            reason: res.error ?? 'list failed',
          });
        }
        members.push(...(res.members ?? []));
        cursor = res.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return members;
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) throw err;
      throw AppError.SLACK_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
}
