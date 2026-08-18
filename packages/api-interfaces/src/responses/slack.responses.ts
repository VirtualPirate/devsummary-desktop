/**
 * One conversation the bot token can see. `isMember` is Slack's own `is_member`
 * on the conversation object — no extra API call — and it is the only warning a
 * channel gives before `chat.postMessage` fails with `not_in_channel`.
 */
export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  memberCount: number | null;
}

export interface SlackInstallation {
  id: string;
  teamId: string;
  teamName: string;
  botUserId: string;
  appId: string;
  scope: string;
  authedUserId: string | null;
  connectedByUserId: string | null;
  createdAt: string;
}
