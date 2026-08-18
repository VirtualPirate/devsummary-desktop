import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT = 'better-auth-token-encryption';

/**
 * Derives a 32-byte encryption key from the provided secret using scrypt.
 */
export function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SALT, KEY_LENGTH);
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns a string in the format: iv:authTag:ciphertext (all base64-encoded).
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decrypts a string produced by encrypt().
 * Expects format: iv:authTag:ciphertext (all base64-encoded).
 */
export function decrypt(encryptedText: string, key: Buffer): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
