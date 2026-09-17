export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export interface SlackCall {
  method: string;
  args: Record<string, unknown>;
}

/** The e2e fakes layer's seam; null for the Jest unit suites. */
let handler: ((call: SlackCall) => unknown) | null = null;
export const __setHandler = (h: ((call: SlackCall) => unknown) | null) => {
  handler = h;
};

const route = (method: string, fallback: () => unknown) =>
  jest.fn((args: Record<string, unknown> = {}) =>
    Promise.resolve(handler ? handler({ method, args }) : fallback()),
  );

export class WebClient {
  static __mockInstances: WebClient[] = [];
  static __reset() {
    WebClient.__mockInstances = [];
    handler = null;
  }

  oauth = {
    v2: {
      access: route('oauth.v2.access', () => ({
        ok: true,
      })),
    },
  };
  auth = {
    revoke: route('auth.revoke', () => ({ ok: true })),
    test: route('auth.test', () => ({
      ok: true,
      team: 'Acme',
      team_id: 'T1',
      user_id: 'U-bot',
      response_metadata: { scopes: ['chat:write', 'channels:read'] },
    })),
  };
  chat = {
    postMessage: route('chat.postMessage', () => ({
      ok: true,
      ts: '1700000000.000100',
    })),
  };
  conversations = {
    list: route('conversations.list', () => ({
      ok: true,
      channels: [],
      response_metadata: {},
    })),
    join: route('conversations.join', () => ({
      ok: true,
      channel: { id: 'C0123ABCDEF' },
    })),
  };
  users = {
    list: route('users.list', () => ({
      ok: true,
      members: [],
      response_metadata: {},
    })),
  };

  constructor(_token?: string, _opts?: { logLevel?: LogLevel }) {
    WebClient.__mockInstances.push(this);
  }
}
