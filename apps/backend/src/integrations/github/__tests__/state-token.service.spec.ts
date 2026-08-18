import { StateTokenService } from '../services/state-token.service';

const SECRET = 'test-secret-do-not-use-elsewhere';

function makeService(now = () => Date.now()) {
  return new StateTokenService(SECRET, now);
}

describe('StateTokenService', () => {
  it('round-trips a payload', () => {
    const svc = makeService();
    const token = svc.sign({ orgId: 'o1', userId: 'u1' });
    const out = svc.verify(token);

    expect(out).toMatchObject({ orgId: 'o1', userId: 'u1' });
    expect(typeof out.nonce).toBe('string');
    expect(typeof out.exp).toBe('number');
  });

  it('rejects an expired token', () => {
    const past = makeService(() => 0);
    const token = past.sign({ orgId: 'o1', userId: 'u1' });
    const future = makeService(() => 11 * 60 * 1000);
    expect(() => future.verify(token)).toThrow(/expired|invalid/i);
  });

  it('rejects a tampered payload', () => {
    const svc = makeService();
    const token = svc.sign({ orgId: 'o1', userId: 'u1' });
    const [payload, sig] = token.split('.');
    const tampered = `${payload}A.${sig}`;
    expect(() => svc.verify(tampered)).toThrow(/invalid/i);
  });

  it('rejects a token signed by a different secret', () => {
    const a = new StateTokenService('secret-a');
    const b = new StateTokenService('secret-b');
    const token = a.sign({ orgId: 'o1', userId: 'u1' });
    expect(() => b.verify(token)).toThrow(/invalid/i);
  });

  it('rejects malformed tokens', () => {
    const svc = makeService();
    expect(() => svc.verify('not-a-token')).toThrow(/invalid/i);
    expect(() => svc.verify('a.b.c')).toThrow(/invalid/i);
  });
});
