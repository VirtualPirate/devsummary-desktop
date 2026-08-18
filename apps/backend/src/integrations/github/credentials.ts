import { decrypt, encrypt } from '../../auth/crypto';
import { AppError } from '../../common/errors';

/**
 * What `github.installations.raw` holds for a PAT credential. There is no
 * dedicated token column and shipped migrations are frozen, so the jsonb column
 * that used to carry the App's installation payload carries the credential
 * instead. Nothing else reads it.
 */
export interface GithubCredentialRaw {
  /** AES-256-GCM `iv:authTag:ciphertext`, per `auth/crypto.ts`. */
  token: string;
  /** `GET /user` response the account columns were derived from. */
  user?: unknown;
}

/**
 * The key is passed in, from `SecretsService.encryptionKey()` — the same seam
 * the Slack token uses. It used to be derived here from `DB_ENCRYPTION_KEY` with
 * a hardcoded `'devsummary-local-dev'` fallback, which is a key every install
 * shares: a stolen `installations.raw` row was decryptable by anyone whenever
 * the shell had not supplied a key. `SecretsService` generates an ephemeral
 * per-boot key instead, so an unreadable token reads as "not connected" (a
 * re-paste) rather than as a token protected by a published passphrase.
 */
export function sealGithubToken(
  token: string,
  user: unknown,
  key: Buffer,
): GithubCredentialRaw {
  return { token: encrypt(token, key), user };
}

/**
 * Anything unreadable — no row, no token, or a key that has since changed —
 * is "not connected", which is the state the settings screen can act on.
 */
export function openGithubToken(raw: unknown, key: Buffer): string {
  const sealed = (raw as GithubCredentialRaw | null)?.token;
  if (!sealed) throw AppError.GITHUB_APP_NOT_CONFIGURED();
  try {
    return decrypt(sealed, key);
  } catch {
    throw AppError.GITHUB_APP_NOT_CONFIGURED();
  }
}
