import { deriveKey, encrypt, decrypt } from './crypto';

describe('crypto', () => {
  const key = deriveKey('test-secret');

  describe('deriveKey', () => {
    it('should return a 32-byte buffer', () => {
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should produce the same key for the same secret', () => {
      const key2 = deriveKey('test-secret');
      expect(key.equals(key2)).toBe(true);
    });

    it('should produce different keys for different secrets', () => {
      const key2 = deriveKey('different-secret');
      expect(key.equals(key2)).toBe(false);
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('should decrypt to the original plaintext', () => {
      const plaintext = 'ya29.a0AfH6SMBx-test-access-token';
      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty string', () => {
      const encrypted = encrypt('', key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe('');
    });

    it('should handle unicode characters', () => {
      const plaintext = 'token-with-unicode-\u00e9\u00e8\u00ea';
      const encrypted = encrypt(plaintext, key);
      const decrypted = decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('encrypt', () => {
    it('should produce different ciphertext for the same plaintext (random IV)', () => {
      const plaintext = 'same-plaintext';
      const encrypted1 = encrypt(plaintext, key);
      const encrypted2 = encrypt(plaintext, key);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should produce output in iv:authTag:ciphertext format', () => {
      const encrypted = encrypt('test', key);
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);
      // Each part should be valid base64
      parts.forEach((part) => {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      });
    });
  });

  describe('decrypt', () => {
    it('should throw with wrong key', () => {
      const wrongKey = deriveKey('wrong-secret');
      const encrypted = encrypt('test-token', key);
      expect(() => decrypt(encrypted, wrongKey)).toThrow();
    });

    it('should throw with corrupted ciphertext', () => {
      const encrypted = encrypt('test-token', key);
      const parts = encrypted.split(':');
      parts[2] = 'corrupted-data';
      const corrupted = parts.join(':');
      expect(() => decrypt(corrupted, key)).toThrow();
    });

    it('should throw with invalid format', () => {
      expect(() => decrypt('not-valid-format', key)).toThrow(
        'Invalid encrypted text format',
      );
    });

    it('should throw with corrupted auth tag', () => {
      const encrypted = encrypt('test-token', key);
      const parts = encrypted.split(':');
      parts[1] = Buffer.from('bad-auth-tag-value').toString('base64');
      const corrupted = parts.join(':');
      expect(() => decrypt(corrupted, key)).toThrow();
    });
  });
});
