import type { SlackCall } from '../../../src/__mocks__/@slack/web-api';

export interface SlackFake {
  /** Every `chat.postMessage` argument object, in order. */
  posts: Array<Record<string, unknown>>;
  /** Answer the next `times` posts with a Slack error string. */
  failNextPost(error: string, times?: number): void;
  /** Make `auth.test` reject, i.e. a token Slack no longer accepts. */
  failAuth(): void;
  channels(list: Array<{ id: string; name: string }>): void;
  reset(): void;
}

export async function installSlack(): Promise<SlackFake> {
  const slack = (await import('@slack/web-api')) as unknown as {
    WebClient: { __reset: () => void };
    __setHandler: (h: ((call: SlackCall) => unknown) | null) => void;
  };
  slack.WebClient.__reset();

  const posts: Array<Record<string, unknown>> = [];
  let postFailure: { error: string; remaining: number } | null = null;
  let authFails = false;
  let channelList: Array<{ id: string; name: string }> = [
    { id: 'C-E2E', name: 'engineering' },
  ];

  slack.__setHandler((call) => {
    switch (call.method) {
      case 'auth.test':
        if (authFails) throw new Error('invalid_auth');
        return {
          ok: true,
          team: 'Acme',
          team_id: 'T1',
          user_id: 'U-bot',
          response_metadata: { scopes: ['chat:write', 'channels:read'] },
        };
      case 'chat.postMessage': {
        posts.push(call.args);
        if (postFailure) {
          postFailure.remaining -= 1;
          const error = postFailure.error;
          if (postFailure.remaining <= 0) postFailure = null;
          // Slack answers a refusal in the body, not as a transport error —
          // which is exactly the shape the deliverer has to notice.
          return { ok: false, error };
        }
        return { ok: true, ts: '1700000000.000100' };
      }
      case 'conversations.list':
        return { ok: true, channels: channelList, response_metadata: {} };
      case 'conversations.join':
        return { ok: true, channel: { id: String(call.args.channel) } };
      case 'users.list':
        return { ok: true, members: [], response_metadata: {} };
      default:
        return { ok: true };
    }
  });

  return {
    posts,
    failNextPost: (error, times = 1) => {
      postFailure = { error, remaining: times };
    },
    failAuth: () => {
      authFails = true;
    },
    channels: (list) => {
      channelList = list;
    },
    reset: () => {
      posts.length = 0;
      postFailure = null;
      authFails = false;
      channelList = [{ id: 'C-E2E', name: 'engineering' }];
    },
  };
}
