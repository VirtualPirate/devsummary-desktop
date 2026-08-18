import { generateInviteToken, hashInviteToken } from '../tokens';

describe('invite token utilities', () => {
  it('generateInviteToken returns a URL-safe base64 string of ~43 chars', () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it('generates distinct tokens', () => {
    expect(generateInviteToken()).not.toEqual(generateInviteToken());
  });

  it('hashInviteToken returns a hex SHA-256 of the token', () => {
    const hash = hashInviteToken('abc');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // Stable output: sha256("abc")
    expect(hash).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
