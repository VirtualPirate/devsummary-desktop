import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { LocalSession } from './local-session.middleware';

/**
 * Drop-in replacement for the `@Session()` decorator the deleted auth wrapper
 * provided: same call shape, reads the same `request.session` that
 * `LocalSessionMiddleware` now populates. Controllers only need their import
 * line swapped.
 */
export const Session = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): LocalSession =>
    ctx.switchToHttp().getRequest<{ session: LocalSession }>().session,
);
