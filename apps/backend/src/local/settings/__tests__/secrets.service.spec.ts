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
  it('boots with an empty bundle rather than throwing', () => {
    const svc = withEnv({});
    expect(svc.status()).toEqual({
      github: false,
      openai: false,
      gemini: false,
      aiConfigured: false,
    });
  });

  // What the GitHub connect gate reads: only the *selected* provider counts,
  // and a CLI provider counts with no key at all.
  it('reports AI configured per selected provider', () => {
    expect(withEnv({ OPENAI_API_KEY: 'sk-1' }).aiConfigured()).toBe(true);
    expect(
      withEnv({
        LLM_PROVIDER: 'gemini',
        OPENAI_API_KEY: 'sk-1',
      }).aiConfigured(),
    ).toBe(false);
    expect(
      withEnv({
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gem-1',
      }).aiConfigured(),
    ).toBe(true);
    expect(withEnv({ LLM_PROVIDER: 'claude-code' }).aiConfigured()).toBe(true);
  });

  // The two provider keys are independent: one can be stored while the other
  // is not, and `LLM_PROVIDER` decides which one is actually used.
  it('reports each provider key on its own', () => {
    const svc = withEnv({ GEMINI_API_KEY: 'gem-1' });
    expect(svc.status()).toMatchObject({ openai: false, gemini: true });
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
    const svc = withEnv({ GEMINI_API_KEY: 'gm-old' });
    svc.update({ GEMINI_API_KEY: '' });
    expect(svc.get('GEMINI_API_KEY')).toBeUndefined();
    expect(svc.status().gemini).toBe(false);
  });

  it('never leaks a value through status()', () => {
    const svc = withEnv({
      GITHUB_TOKEN: 'ghp-secret',
      OPENAI_API_KEY: 'sk-secret',
      GEMINI_API_KEY: 'gm-secret',
    });
    const serialized = JSON.stringify(svc.status());
    for (const secret of ['ghp-secret', 'sk-secret', 'gm-secret']) {
      expect(serialized).not.toContain(secret);
    }
    expect(svc.status()).toMatchObject({
      github: true,
      openai: true,
      gemini: true,
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

  it('carries the Cursor model overrides', () => {
    expect(SECRET_KEYS).toContain('CURSOR_COMMIT_ANALYSIS_MODEL');
    expect(SECRET_KEYS).toContain('CURSOR_BRIEF_MODEL');
  });

  // No CLI has one: each uses the login already in the user's terminal.
  it('does not invent an API key for any CLI', () => {
    expect(SECRET_KEYS).not.toContain('CLAUDE_CODE_API_KEY');
    expect(SECRET_KEYS).not.toContain('OPENCODE_API_KEY');
    expect(SECRET_KEYS).not.toContain('CURSOR_API_KEY');
  });
});
