export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export class WebClient {
  static __mockInstances: WebClient[] = [];
  static __reset() {
    WebClient.__mockInstances = [];
  }

  oauth = {
    v2: {
      access: jest.fn(() =>
        Promise.resolve({ ok: true } as Record<string, unknown>),
      ),
    },
  };
  auth = {
    revoke: jest.fn(() => Promise.resolve({ ok: true })),
  };
  chat = {
    postMessage: jest.fn(() =>
      Promise.resolve({ ok: true, ts: '1700000000.000100' }),
    ),
  };
  conversations = {
    list: jest.fn(() =>
      Promise.resolve({ ok: true, channels: [], response_metadata: {} }),
    ),
    join: jest.fn(() =>
      Promise.resolve({ ok: true, channel: { id: 'C0123ABCDEF' } }),
    ),
  };
  users = {
    list: jest.fn(() =>
      Promise.resolve({ ok: true, members: [], response_metadata: {} }),
    ),
  };

  constructor(_token?: string, _opts?: { logLevel?: LogLevel }) {
    WebClient.__mockInstances.push(this);
  }
}
