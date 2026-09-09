import { SECRET_KEYS, SecretsService } from '../secrets.service';

function withEnv(env: Record<string, string | undefined>): SecretsService {
  const saved: Record<string, string | undefined> = {};
  for (const key of SECRET_KEYS) {
    saved[key] = process.env[key];
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const svc = new SecretsService();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return svc;
}

afterEach(() => {
  delete (process as { parentPort?: unknown }).parentPort;
});

describe('SecretsService', () => {
  it('boots with an empty bundle and no SMTP rather than throwing', () => {
    const svc = withEnv({});
    expect(svc.smtp()).toBeNull();
    expect(svc.status()).toEqual({
      github: false,
      openai: false,
      gemini: false,
      smtp: false,
      slack: false,
      emailFrom: false,
    });
  });

  // The two provider keys are independent: one can be stored while the other
  // is not, and `LLM_PROVIDER` decides which one is actually used.
  it('reports each provider key on its own', () => {
    const svc = withEnv({ GEMINI_API_KEY: 'gem-1' });
    expect(svc.status()).toMatchObject({ openai: false, gemini: true });
  });

  it('treats a blank env var as absent', () => {
    const svc = withEnv({
      SMTP_HOST: '   ',
      SMTP_USER: 'me@example.com',
      SMTP_PASS: 'pw',
    });
    expect(svc.smtp()).toBeNull();
  });

  it('defaults the SMTP port and falls back to the user as the from address', () => {
    const svc = withEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'me@example.com',
      SMTP_PASS: 'pw',
    });
    expect(svc.smtp()).toEqual({
      host: 'smtp.example.com',
      port: 587,
      user: 'me@example.com',
      pass: 'pw',
      from: 'me@example.com',
    });
  });

  it('previews an overlay without committing it', () => {
    const svc = withEnv({});
    expect(
      svc.smtp({
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
        SMTP_PORT: '465',
      }),
    ).toMatchObject({ port: 465 });
    expect(svc.smtp()).toBeNull();
  });

  it('posts the whole bundle to the Electron main process on update', () => {
    const posted: unknown[] = [];
    (process as { parentPort?: unknown }).parentPort = {
      postMessage: (m: unknown) => posted.push(m),
    };
    const svc = withEnv({ OPENAI_API_KEY: 'sk-old' });

    svc.update({ OPENAI_API_KEY: 'sk-new', GITHUB_TOKEN: 'ghp-1' });

    expect(posted).toEqual([
      {
        type: 'secrets:save',
        bundle: { OPENAI_API_KEY: 'sk-new', GITHUB_TOKEN: 'ghp-1' },
      },
    ]);
    expect(svc.get('OPENAI_API_KEY')).toBe('sk-new');
  });

  it('updates memory only when there is no Electron parent port', () => {
    const svc = withEnv({});
    expect(() => svc.update({ GITHUB_TOKEN: 'ghp-1' })).not.toThrow();
    expect(svc.get('GITHUB_TOKEN')).toBe('ghp-1');
  });

  it('clears a credential when the update blanks it', () => {
    const svc = withEnv({ SLACK_BOT_TOKEN: 'xoxb-old' });
    svc.update({ SLACK_BOT_TOKEN: '' });
    expect(svc.get('SLACK_BOT_TOKEN')).toBeUndefined();
    expect(svc.status().slack).toBe(false);
  });

  it('never leaks a value through status()', () => {
    const svc = withEnv({
      GITHUB_TOKEN: 'ghp-secret',
      OPENAI_API_KEY: 'sk-secret',
      SLACK_BOT_TOKEN: 'xoxb-secret',
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'me@example.com',
      SMTP_PASS: 'super-secret',
      EMAIL_FROM: 'me@example.com',
    });
    const serialized = JSON.stringify(svc.status());
    for (const secret of [
      'ghp-secret',
      'sk-secret',
      'xoxb-secret',
      'super-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(svc.status()).toMatchObject({
      github: true,
      openai: true,
      slack: true,
      smtp: true,
    });
  });

  it('derives a stable encryption key from the supplied one', () => {
    const svc = withEnv({ DB_ENCRYPTION_KEY: 'k'.repeat(64) });
    expect(svc.encryptionKey()).toEqual(svc.encryptionKey());
    expect(svc.encryptionKey()).toHaveLength(32);
  });

  it('falls back to a per-boot key rather than a fixed one when none is supplied', () => {
    const a = withEnv({});
    const b = withEnv({});
    expect(a.encryptionKey()).not.toEqual(b.encryptionKey());
    // Stable within a boot, so anything written stays readable until restart.
    expect(a.encryptionKey()).toEqual(a.encryptionKey());
  });
});

// Not secrets, but they ride the same bundle: it is the only thing the shell
// persists, so a model chosen in settings has nowhere else to survive a restart.
describe('SECRET_KEYS', () => {
  it('carries the Claude Code model overrides', () => {
    expect(SECRET_KEYS).toContain('CLAUDE_CODE_COMMIT_ANALYSIS_MODEL');
    expect(SECRET_KEYS).toContain('CLAUDE_CODE_BRIEF_MODEL');
  });

  it('carries the OpenCode model overrides', () => {
    expect(SECRET_KEYS).toContain('OPENCODE_COMMIT_ANALYSIS_MODEL');
    expect(SECRET_KEYS).toContain('OPENCODE_BRIEF_MODEL');
  });

  // Neither CLI has one: each uses the login already in the user's terminal.
  it('does not invent an API key for either CLI', () => {
    expect(SECRET_KEYS).not.toContain('CLAUDE_CODE_API_KEY');
    expect(SECRET_KEYS).not.toContain('OPENCODE_API_KEY');
  });
});
