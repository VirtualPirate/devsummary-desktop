import { createHmac } from 'node:crypto';
import { WebhookVerifierService } from '../services/webhook-verifier.service';

const SECRET = 'webhook-test-secret';

function sign(body: Buffer | string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('WebhookVerifierService', () => {
  it('accepts a correctly signed body', () => {
    const svc = new WebhookVerifierService();
    const body = Buffer.from('{"hello":"world"}');
    expect(() =>
      svc.verify({ body, signature: sign(body), secret: SECRET }),
    ).not.toThrow();
  });

  it('throws when header is absent', () => {
    const svc = new WebhookVerifierService();
    expect(() =>
      svc.verify({
        body: Buffer.from('x'),
        signature: undefined,
        secret: SECRET,
      }),
    ).toThrow(/missing/i);
  });

  it('throws on mismatched signature', () => {
    const svc = new WebhookVerifierService();
    const body = Buffer.from('{"hello":"world"}');
    expect(() =>
      svc.verify({ body, signature: sign(body, 'wrong'), secret: SECRET }),
    ).toThrow(/invalid/i);
  });

  it('throws on length mismatch', () => {
    const svc = new WebhookVerifierService();
    expect(() =>
      svc.verify({
        body: Buffer.from('x'),
        signature: 'sha256=short',
        secret: SECRET,
      }),
    ).toThrow(/invalid/i);
  });

  it('throws when prefix is wrong', () => {
    const svc = new WebhookVerifierService();
    const body = Buffer.from('x');
    const sig = sign(body).replace('sha256=', 'sha1=');
    expect(() => svc.verify({ body, signature: sig, secret: SECRET })).toThrow(
      /invalid/i,
    );
  });
});
