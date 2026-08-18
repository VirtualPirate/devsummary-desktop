import { decrypt, deriveKey, encrypt } from '../../auth/crypto';
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
 * `crypto.ts` wants a 32-byte Buffer, which it derives from a *secret string*
 * with scrypt — so this is a passphrase, not raw key material.
 *
 * `DB_ENCRYPTION_KEY` is generated once on first launch and handed to the
 * backend by the Electron main process (safeStorage). The fallback keeps a
 * headless `pnpm start:dev` working; losing or changing the key only costs the
 * user a re-paste, since the token is the only thing encrypted with it.
 */
const DEV_FALLBACK_SECRET = 'devsummary-local-dev';

let cached: { secret: string; key: Buffer } | null = null;

function encryptionKey(): Buffer {
  const secret = process.env.DB_ENCRYPTION_KEY || DEV_FALLBACK_SECRET;
  if (cached?.secret !== secret) {
    cached = { secret, key: deriveKey(secret) };
  }
  return cached.key;
}

export function sealGithubToken(
  token: string,
  user: unknown,
): GithubCredentialRaw {
  return { token: encrypt(token, encryptionKey()), user };
}

/**
 * Anything unreadable — no row, no token, or a key that has since changed —
 * is "not connected", which is the state the settings screen can act on.
 */
export function openGithubToken(raw: unknown): string {
  const sealed = (raw as GithubCredentialRaw | null)?.token;
  if (!sealed) throw AppError.GITHUB_APP_NOT_CONFIGURED();
  try {
    return decrypt(sealed, encryptionKey());
  } catch {
    throw AppError.GITHUB_APP_NOT_CONFIGURED();
  }
}
