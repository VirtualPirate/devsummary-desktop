import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors';

const LIMIT = 5;
const WINDOW_MS = 60_000;
/** Sweep stale keys past this many tracked clients, so the map stays bounded. */
const MAX_KEYS = 10_000;

/**
 * 5 requests per minute per client, sliding window, held in memory.
 *
 * ponytail: the client is its IP address, and the counter is per-process. Two
 * API instances therefore allow 5/min each, and everyone behind one NAT shares
 * a budget. Move the counter into Redis (or adopt `@nestjs/throttler` with a
 * store) if either becomes real; add Turnstile if the abuse is a botnet rather
 * than a loop.
 */
@Injectable()
export class WaitlistRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // `req.ip` is the socket address unless express `trust proxy` is enabled
    // (it is not). Reading X-Forwarded-For directly instead would let any
    // caller mint a fresh identity per request by editing a header, so behind
    // a load balancer the fix is to turn `trust proxy` on in configure-app.ts,
    // not to trust the header here.
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    if (this.hits.size > MAX_KEYS) {
      this.sweep(cutoff);
    }

    const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    this.hits.set(key, recent);

    if (recent.length >= LIMIT) {
      // The oldest hit leaves the window at `oldest + WINDOW_MS`, which is
      // `oldest - cutoff` milliseconds from now.
      throw AppError.WAITLIST_RATE_LIMITED({
        retryAfterSeconds: Math.ceil((recent[0] - cutoff) / 1000),
      });
    }

    recent.push(now);
    return true;
  }

  private sweep(cutoff: number): void {
    for (const [key, timestamps] of this.hits) {
      if (timestamps.every((at) => at <= cutoff)) {
        this.hits.delete(key);
      }
    }
  }
}
