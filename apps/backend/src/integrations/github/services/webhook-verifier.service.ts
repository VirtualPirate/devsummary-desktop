import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../common/errors';

@Injectable()
export class WebhookVerifierService {
  verify(input: {
    body: Buffer;
    signature: string | undefined;
    secret: string;
  }): void {
    const { body, signature, secret } = input;

    if (!signature) {
      throw AppError.GITHUB_WEBHOOK_SIGNATURE_MISSING();
    }

    if (!signature.startsWith('sha256=')) {
      throw AppError.GITHUB_WEBHOOK_SIGNATURE_INVALID();
    }

    const providedHex = signature.slice('sha256='.length);
    const provided = Buffer.from(providedHex, 'hex');
    const expected = createHmac('sha256', secret).update(body).digest();

    if (provided.length !== expected.length) {
      throw AppError.GITHUB_WEBHOOK_SIGNATURE_INVALID();
    }

    if (!timingSafeEqual(provided, expected)) {
      throw AppError.GITHUB_WEBHOOK_SIGNATURE_INVALID();
    }
  }
}
