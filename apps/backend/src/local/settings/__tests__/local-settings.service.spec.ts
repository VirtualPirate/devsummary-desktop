import { BadRequestException } from '@nestjs/common';
import { claudeCodeAdapter } from '../../../common/llm';
import { LocalSettingsService } from '../local-settings.service';

const INSTALLED = {
  id: 'claude-code' as const,
  displayName: 'Claude Code',
  installed: true,
  path: '/usr/bin/claude',
  version: '2.1.265',
  authenticated: true,
  installHint: claudeCodeAdapter.installHint,
};

function makeService(bundle: Record<string, string | undefined> = {}) {
  const secrets = {
    get: jest.fn((key: string) => bundle[key]),
    update: jest.fn(),
    smtp: jest.fn().mockReturnValue(null),
    status: jest.fn().mockReturnValue({
      github: false,
      openai: false,
      gemini: false,
      smtp: false,
      slack: false,
      emailFrom: false,
    }),
  };
  const settings = {
    desktopNotificationsEnabled: jest.fn().mockResolvedValue(false),
    setDesktopNotifications: jest.fn(),
    tokenTotals: jest.fn(),
  };
  const slackInstalls = { connectToken: jest.fn() };
  const detector = {
    detect: jest.fn().mockResolvedValue(INSTALLED),
    detectAll: jest.fn().mockResolvedValue([INSTALLED]),
    binaryPath: jest.fn().mockResolvedValue('/usr/bin/claude'),
  };
  const svc = new LocalSettingsService(
    secrets as never,
    settings as never,
    slackInstalls as never,
    detector as never,
  );
  return { svc, secrets, settings, detector };
}

describe('LocalSettingsService.updateCredentials with a CLI provider', () => {
  // Storing a provider that cannot run would fail every job with
  // NOT_CONFIGURED and leave the page showing a provider nothing can use.
  it('refuses an uninstalled CLI and stores nothing', async () => {
    const { svc, secrets, detector } = makeService();
    detector.detect.mockResolvedValue({
      ...INSTALLED,
      installed: false,
      path: null,
      version: null,
      authenticated: null,
    });

    await expect(
      svc.updateCredentials('org-1', { llmProvider: 'claude-code' }),
    ).rejects.toThrow(BadRequestException);
    expect(secrets.update).not.toHaveBeenCalled();
  });

  it('forces a fresh detect rather than trusting the 60 s cache', async () => {
    const { svc, detector } = makeService();
    await svc.updateCredentials('org-1', { llmProvider: 'claude-code' });
    expect(detector.detect).toHaveBeenCalledWith('claude-code', {
      force: true,
    });
  });

  // Not logged in is allowed: the card warns, and the fix (`claude /login`) is
  // outside the app.
  it('accepts an installed but logged-out CLI', async () => {
    const { svc, secrets, detector } = makeService();
    detector.detect.mockResolvedValue({ ...INSTALLED, authenticated: false });

    await svc.updateCredentials('org-1', { llmProvider: 'claude-code' });

    expect(secrets.update).toHaveBeenCalledWith({
      LLM_PROVIDER: 'claude-code',
    });
  });

  it('writes a model override under the CLI provider’s own vars', async () => {
    const { svc, secrets } = makeService();

    await svc.updateCredentials('org-1', {
      llmProvider: 'claude-code',
      commitAnalysisModel: 'claude-haiku-4-5',
      briefModel: 'claude-sonnet-4-6',
    });

    expect(secrets.update).toHaveBeenCalledWith({
      LLM_PROVIDER: 'claude-code',
      CLAUDE_CODE_COMMIT_ANALYSIS_MODEL: 'claude-haiku-4-5',
      CLAUDE_CODE_BRIEF_MODEL: 'claude-sonnet-4-6',
    });
  });

  it('does not detect anything when a key provider is selected', async () => {
    const { svc, detector } = makeService();
    await svc.updateCredentials('org-1', { llmProvider: 'openai' });
    expect(detector.detect).not.toHaveBeenCalled();
  });
});

describe('LocalSettingsService.status with a CLI provider', () => {
  it('reports the CLI’s split defaults', async () => {
    const { svc } = makeService({ LLM_PROVIDER: 'claude-code' });

    await expect(svc.status()).resolves.toMatchObject({
      llmProvider: 'claude-code',
      commitAnalysisModel: 'haiku',
      briefModel: 'sonnet',
    });
  });
});

describe('LocalSettingsService.agentClis', () => {
  it('passes the refresh flag through to the detector', async () => {
    const { svc, detector } = makeService();

    await expect(svc.agentClis(true)).resolves.toEqual([INSTALLED]);
    expect(detector.detectAll).toHaveBeenCalledWith(true);
  });
});

describe('LocalSettingsService.testAgentCli', () => {
  it('refuses to test a CLI that is not installed', async () => {
    const { svc, detector } = makeService();
    detector.detect.mockResolvedValue({
      ...INSTALLED,
      installed: false,
      path: null,
    });

    await expect(svc.testAgentCli('claude-code')).rejects.toThrow(
      BadRequestException,
    );
  });

  // The uninstalled-between-check-and-call case: the guard passed, the client
  // found nothing to spawn, and the mapped reason has to reach the toast.
  it('reports the client’s own failure as a 400', async () => {
    const { svc, detector } = makeService();
    detector.binaryPath.mockResolvedValue(null);

    await expect(svc.testAgentCli('claude-code')).rejects.toThrow(
      /Claude Code test failed: Claude Code is not installed/,
    );
  });
});
