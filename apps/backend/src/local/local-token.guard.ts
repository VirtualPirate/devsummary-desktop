import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/errors';

/**
 * Health is reachable without the token: Electron's main process polls it to
 * decide whether the forked backend came up, and it has no secrets to leak
 * (`GET /api/health` reports dependency status, `GET /api/health/live` a
 * constant). Everything else on loopback needs the per-boot token.
 */
const PUBLIC_PREFIX = '/api/health';

/**
 * The only thing between this API and every other process on the machine —
 * `app.listen(0, '127.0.0.1')` keeps the port off the LAN but not off the box.
 * Fail-closed: no `API_TOKEN` in the environment means nothing is reachable.
 */
@Injectable()
export class LocalTokenGuard implements CanActivate {
  private readonly token = Buffer.from(process.env.API_TOKEN ?? '', 'utf8');

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      url?: string;
      headers: Record<string, string | string[] | undefined>;
    }>();

    const path = (req.url ?? '').split('?')[0];
    if (path === PUBLIC_PREFIX || path.startsWith(`${PUBLIC_PREFIX}/`)) {
      return true;
    }

    const got = req.headers['x-desktop-token'];
    if (this.token.length === 0 || typeof got !== 'string') {
      throw AppError.UNAUTHENTICATED();
    }
    const given = Buffer.from(got, 'utf8');
    if (
      given.length !== this.token.length ||
      !timingSafeEqual(given, this.token)
    ) {
      throw AppError.UNAUTHENTICATED();
    }
    return true;
  }
}
