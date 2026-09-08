import {
  LogLevel,
  WebClient,
  type AuthRevokeResponse,
  type AuthTestResponse,
  type ChatPostMessageArguments,
  type ChatPostMessageResponse,
  type ConversationsJoinResponse,
  type ConversationsListResponse,
  type UsersListResponse,
} from '@slack/web-api';
import { AppError } from '../../common/errors';

export type SlackBlock = Record<string, unknown>;

/** The SDK's block union, reached through the postMessage argument type:
 * `@slack/types` (which declares it) is transitive, not a dependency here. */
type PostMessageBlocks = Extract<
  ChatPostMessageArguments,
  { blocks: unknown[] }
>['blocks'];

type Channel = NonNullable<ConversationsListResponse['channels']>[number];
type Member = NonNullable<UsersListResponse['members']>[number];

export class SlackClient {
  private readonly webClient: WebClient;

  constructor() {
    this.webClient = new WebClient(undefined, { logLevel: LogLevel.WARN });
  }

  /**
   * The pasted-token replacement for the OAuth code exchange: it proves the
   * token works and hands back the workspace identity the installation row
   * needs. `response_metadata.scopes` is `@slack/web-api`'s parse of the
   * `x-oauth-scopes` header, which is the only place a bot token's granted
   * scopes are visible — the settings screen diffs it against
   * `SLACK_BOT_SCOPES` to name what is missing.
   */
  async authTest(accessToken: string): Promise<AuthTestResponse> {
    let response: AuthTestResponse;
    try {
      response = await this.webClient.auth.test({ token: accessToken });
    } catch (err) {
      throw AppError.SLACK_API_FAILED({
        reason: err instanceof Error ? err.message : 'Unknown error',
      });
    }
    if (!response.ok) {
      throw AppError.SLACK_API_FAILED({
        reason: response.error ?? 'invalid_auth',
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
        blocks: blocks as unknown as PostMessageBlocks,
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
