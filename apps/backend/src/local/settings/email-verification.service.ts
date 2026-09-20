import { Injectable, Logger } from '@nestjs/common';
import type { EmailVerificationStatus } from '@launchstack/api-interfaces';
import { isValidEmail } from '@launchstack/core';
import { AppError } from '../../common/errors';
import { LocalSettingsRepository } from './local-settings.repository';

/** Key in `local_settings` holding {@link StoredState}. */
export const EMAIL_VERIFICATION_KEY = 'email_verification';

/** The API's own token TTL. Past it, only a fresh link can verify anything. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Overridable so tests and a local API never reach the production host. Read per
 * call, not at import time: a module-level const is evaluated before
 * `ConfigModule` loads `.env`, and `||` rather than `??` because a key present
 * but empty (as `.env.example` ships it) must fall back, not build a relative
 * URL that `fetch` rejects.
 */
function apiOrigin(): string {
  return process.env.DESKTOP_API_ORIGIN || 'https://api.devsummary.com';
}

type StoredState =
  | { status: 'pending'; email: string; requestedAt: string }
  | { status: 'verified'; email: string; verifiedAt: string };

/**
 * Trim and lowercase once, exactly as the API does, so our key and its key are
 * the same string. Returns `null` for anything that cannot be an address.
 */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  // Shape only — the API parses stricter, and its 400 is what the form shows.
  if (!isValidEmail(email)) return null;
  return email;
}

type UpstreamError = Error & { code?: string; retryAfterSeconds?: number };

/**
 * Optional email verification, end to end.
 *
 * There is no account, no session and no API key: the app posts an address, the
 * user clicks a link in their inbox, and the app asks whether that address is
 * marked verified. The answer lives in `local_settings` and is never cleared by
 * a failed or offline check.
 *
 * **Nothing in the app is gated on it today** — no repository limit, no feature
 * flag. It exists so the flow is built and an address is on record; whatever
 * gets gated on it later reads the stored `verified` status from here rather
 * than calling the API again.
 *
 * The app never sees the token and never opens the landing page itself; that
 * URL is for a human in a normal browser.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(private readonly settings: LocalSettingsRepository) {}

  private read(): Promise<StoredState | null> {
    return this.settings.get<StoredState | null>(EMAIL_VERIFICATION_KEY, null);
  }

  /**
   * Ask for a link, then check once — a 201 says a mail *may* have gone out, not
   * that the address is new: an already-verified address is a silent no-op
   * upstream, and only the check can tell those apart.
   */
  async request(rawEmail: string): Promise<EmailVerificationStatus> {
    const email = normalizeEmail(rawEmail);
    if (!email) {
      throw AppError.BAD_REQUEST({ message: 'Enter a valid email address' });
    }

    await this.post(email);
    await this.settings.set(EMAIL_VERIFICATION_KEY, {
      status: 'pending',
      email,
      requestedAt: new Date().toISOString(),
    } satisfies StoredState);

    return this.check();
  }

  /**
   * One poll. A verified install answers from disk — the answer is already
   * stored and re-asking can only cost a request.
   *
   * A pending check that cannot reach the API stays pending rather than
   * throwing: the caller is a 4-second poll, and an offline laptop is not a
   * reason to redden the screen. Nothing here can *clear* a verified flag.
   */
  async check(): Promise<EmailVerificationStatus> {
    const state = await this.read();
    if (state === null || state.status === 'verified') return present(state);

    let verified: boolean;
    try {
      verified = await this.get(state.email);
    } catch (err) {
      this.logger.warn(
        `verification check failed for ${state.email}: ${describe(err)}`,
      );
      return present(state);
    }
    if (!verified) return present(state);

    const next: StoredState = {
      status: 'verified',
      email: state.email,
      verifiedAt: new Date().toISOString(),
    };
    await this.settings.set(EMAIL_VERIFICATION_KEY, next);
    this.logger.log(`${state.email} verified`);
    return present(next);
  }

  private async post(email: string): Promise<void> {
    const res = await fetch(`${apiOrigin()}/api/desktop/verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.ok) return;

    const err = await upstreamError(res);
    if (err.code === 'RATE_LIMITED') {
      throw AppError.EMAIL_VERIFICATION_RATE_LIMITED({
        retryAfterSeconds: err.retryAfterSeconds ?? 60,
      });
    }
    if (res.status === 400) {
      throw AppError.BAD_REQUEST({ message: err.message });
    }
    throw AppError.EMAIL_VERIFICATION_SEND_FAILED({ reason: err.message });
  }

  private async get(email: string): Promise<boolean> {
    const url = new URL('/api/desktop/verification', apiOrigin());
    url.searchParams.set('email', email);
    const res = await fetch(url);
    if (!res.ok) throw await upstreamError(res);

    const body = (await res.json()) as { data?: { verified?: boolean } };
    return body.data?.verified === true;
  }
}

function present(state: StoredState | null): EmailVerificationStatus {
  return {
    status: state?.status ?? 'unverified',
    email: state?.email ?? null,
    requestedAt: state?.status === 'pending' ? state.requestedAt : null,
    verifiedAt: state?.status === 'verified' ? state.verifiedAt : null,
    linkExpired:
      state?.status === 'pending' &&
      Date.now() - Date.parse(state.requestedAt) > PENDING_TTL_MS,
  };
}

/**
 * The API answers errors as `{ code, message, details }` with no `success`
 * field, so match on `code` and status — never on the message text.
 */
async function upstreamError(res: Response): Promise<UpstreamError> {
  const body = (await res.json().catch(() => null)) as {
    code?: string;
    message?: string;
    details?: { retryAfterSeconds?: number };
  } | null;
  const error: UpstreamError = new Error(body?.message ?? `HTTP ${res.status}`);
  error.code = body?.code;
  // There is no Retry-After header on these responses; the seconds ride in
  // `details`.
  error.retryAfterSeconds = body?.details?.retryAfterSeconds;
  return error;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
