import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { LocalSettingsStatus } from '@launchstack/api-interfaces';
import { deriveKey } from '../../auth/crypto';
import { parentPort } from './parent-port';
import type { SmtpSettings } from './smtp';

/**
 * The bundle the Electron main process decrypts out of `safeStorage` and hands
 * to this process as env at fork time. Nothing here is ever written to disk or
 * to a log line by the backend — persistence is the shell's job, over IPC.
 */
export const SECRET_KEYS = [
  'GITHUB_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'DB_ENCRYPTION_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'EMAIL_FROM',
  'SLACK_BOT_TOKEN',
  // Not secrets, but they ride the same bundle: it is the only thing the shell
  // persists, so a choice made in settings has nowhere else to survive a
  // restart. `status()` reports the provider (the UI has to preselect it) but
  // never the models — those are answered as effective values by
  // `LocalSettingsService`, and a model name is not a credential.
  'LLM_PROVIDER',
  'OPENAI_COMMIT_ANALYSIS_MODEL',
  'OPENAI_BRIEF_MODEL',
  'GEMINI_COMMIT_ANALYSIS_MODEL',
  'GEMINI_BRIEF_MODEL',
  // Agent CLIs have no key of their own — they use the login already held by
  // their local binary — so only their model overrides ride the bundle.
  'CLAUDE_CODE_COMMIT_ANALYSIS_MODEL',
  'CLAUDE_CODE_BRIEF_MODEL',
  'OPENCODE_COMMIT_ANALYSIS_MODEL',
  'OPENCODE_BRIEF_MODEL',
  'CURSOR_COMMIT_ANALYSIS_MODEL',
  'CURSOR_BRIEF_MODEL',
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];
export type SecretBundle = Partial<Record<SecretKey, string>>;

/** The credential half of `LocalSettingsStatus`; the rest is the DB and env. */
export type CredentialStatus = Pick<
  LocalSettingsStatus,
  'github' | 'openai' | 'gemini' | 'smtp' | 'slack' | 'emailFrom'
>;

const DEFAULT_SMTP_PORT = 587;

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);
  private readonly bundle: SecretBundle = {};

  constructor() {
    for (const key of SECRET_KEYS) {
      const value = blankToUndefined(process.env[key]);
      if (value) this.bundle[key] = value;
    }
  }

  get(key: SecretKey): string | undefined {
    return this.bundle[key];
  }

  /**
   * Updates the live copy, then asks the Electron main process to re-encrypt the
   * whole bundle into `userData/secrets.bin` via `safeStorage`. Outside Electron
   * there is no parent port, so the update is memory-only for this boot — which
   * is exactly right for headless dev.
   *
   * `process.env` is written alongside because env is the seam every consumer
   * already reads through: `ConfigService.get` falls through to `process.env`
   * live, so `loadBriefsConfig` / `loadCommitAnalysisConfig` see a key pasted
   * mid-session without a restart. Skipping this is what made a freshly pasted
   * OpenAI key silently do nothing until the app was relaunched.
   */
  update(partial: SecretBundle): void {
    for (const [key, value] of Object.entries(partial) as Array<
      [SecretKey, string | undefined]
    >) {
      const clean = blankToUndefined(value);
      if (clean) {
        this.bundle[key] = clean;
        process.env[key] = clean;
      } else {
        delete this.bundle[key];
        delete process.env[key];
      }
    }

    const port = parentPort();
    if (!port) {
      this.logger.warn(
        'No Electron parent port; secrets updated in memory only for this boot',
      );
      return;
    }
    port.postMessage({ type: 'secrets:save', bundle: { ...this.bundle } });
  }

  /**
   * The AES key protecting the stored GitHub PAT and Slack bot token. When the
   * shell has not supplied one (headless dev, tests) a per-boot key is used
   * rather than a fixed fallback: a rewritable credential is recoverable, a
   * hardcoded key on every install is not.
   */
  encryptionKey(): Buffer {
    let secret = this.bundle.DB_ENCRYPTION_KEY;
    if (!secret) {
      secret = randomBytes(32).toString('hex');
      this.bundle.DB_ENCRYPTION_KEY = secret;
      this.logger.warn(
        'DB_ENCRYPTION_KEY not supplied; using an ephemeral per-boot key',
      );
    }
    return deriveKey(secret);
  }

  /**
   * `null` means "email channel not configured" — never a boot failure.
   * `overlay` lets a settings write be verified against the *merged* result
   * before it is committed, without exposing the bundle itself.
   */
  smtp(overlay?: SecretBundle): SmtpSettings | null {
    const { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT, EMAIL_FROM } = {
      ...this.bundle,
      ...overlay,
    };
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
    const port = Number(SMTP_PORT);
    return {
      host: SMTP_HOST,
      port: Number.isFinite(port) && port > 0 ? port : DEFAULT_SMTP_PORT,
      user: SMTP_USER,
      pass: SMTP_PASS,
      from: EMAIL_FROM ?? SMTP_USER,
    };
  }

  /** Booleans only. A value never leaves this process except to its provider. */
  status(): CredentialStatus {
    return {
      github: Boolean(this.bundle.GITHUB_TOKEN),
      openai: Boolean(this.bundle.OPENAI_API_KEY),
      gemini: Boolean(this.bundle.GEMINI_API_KEY),
      smtp: this.smtp() !== null,
      slack: Boolean(this.bundle.SLACK_BOT_TOKEN),
      emailFrom: Boolean(this.bundle.EMAIL_FROM),
    };
  }
}
