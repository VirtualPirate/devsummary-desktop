import { Injectable, type NestMiddleware } from '@nestjs/common';
import {
  LOCAL_USER_EMAIL,
  LOCAL_USER_ID,
  LOCAL_USER_NAME,
} from './local-identity';

export type LocalSession = {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
  };
};

const SESSION: LocalSession = {
  user: {
    id: LOCAL_USER_ID,
    email: LOCAL_USER_EMAIL,
    name: LOCAL_USER_NAME,
    emailVerified: true,
  },
};

/**
 * Stands in for the Better Auth wrapper, which populated `request.session` on
 * every request. There is exactly one user on a desktop install, so the shim is
 * a constant. Middleware rather than a guard on purpose: middleware always runs
 * before every guard, so `OrgContextGuard` can read `request.session.user.id`
 * without depending on global-guard registration order.
 */
@Injectable()
export class LocalSessionMiddleware implements NestMiddleware {
  use(req: { session?: LocalSession }, _res: unknown, next: () => void): void {
    req.session = SESSION;
    next();
  }
}
