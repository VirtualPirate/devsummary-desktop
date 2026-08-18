import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { deriveKey } from '../../../auth/crypto';

const TEN_MINUTES_MS = 10 * 60 * 1000;

export interface StateTokenPayload {
  orgId: string;
  userId: string;
  nonce: string;
  exp: number;
}

function encodeBase64Url(input: Buffer): string {
  return input.toString('base64url');
}

@Injectable()
export class StateTokenService {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.key = deriveKey(secret);
  }

  sign(input: { orgId: string; userId: string }): string {
    const payload: StateTokenPayload = {
      orgId: input.orgId,
      userId: input.userId,
      nonce: randomBytes(8).toString('hex'),
      exp: this.now() + TEN_MINUTES_MS,
    };

    const payloadB64 = encodeBase64Url(Buffer.from(JSON.stringify(payload)));
    const signatureB64 = encodeBase64Url(
      createHmac('sha256', this.key).update(payloadB64).digest(),
    );

    return `${payloadB64}.${signatureB64}`;
  }

  verify(token: string): StateTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid state token');
    }

    const [payloadB64, signatureB64] = parts;
    const expectedDigest = createHmac('sha256', this.key)
      .update(payloadB64)
      .digest();

    let providedDigest: Buffer;
    try {
      providedDigest = Buffer.from(signatureB64, 'base64url');
    } catch {
      throw new Error('Invalid state token signature');
    }

    if (
      providedDigest.length !== expectedDigest.length ||
      !timingSafeEqual(providedDigest, expectedDigest)
    ) {
      throw new Error('Invalid state token signature');
    }

    let payload: StateTokenPayload;
    try {
      payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      ) as StateTokenPayload;
    } catch {
      throw new Error('Invalid state token payload');
    }

    if (
      typeof payload.orgId !== 'string' ||
      typeof payload.userId !== 'string' ||
      typeof payload.nonce !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new Error('Invalid state token payload shape');
    }

    if (this.now() > payload.exp) {
      throw new Error('State token expired');
    }

    return payload;
  }
}
