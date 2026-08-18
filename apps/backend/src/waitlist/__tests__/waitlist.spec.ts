import type { ExecutionContext } from '@nestjs/common';
import { ZodValidationPipe } from '../../organizations/dto';
import { ApiException } from '../../common/errors';
import { JoinWaitlistSchema } from '../waitlist.controller';
import { WaitlistRateLimitGuard } from '../waitlist-rate-limit.guard';

describe('waitlist', () => {
  it('normalizes the email and rejects malformed input', () => {
    const pipe = new ZodValidationPipe(JoinWaitlistSchema);

    expect(pipe.transform({ email: '  Founder@Example.COM ' })).toEqual({
      email: 'founder@example.com',
    });
    expect(() => pipe.transform({ email: 'not-an-email' })).toThrow(
      ApiException,
    );
    expect(() => pipe.transform({})).toThrow(ApiException);
  });
});

describe('waitlist rate limit', () => {
  function contextFor(ip: string): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ ip, socket: {} }) }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('allows 5 per minute per client and blocks the 6th', () => {
    const guard = new WaitlistRateLimitGuard();
    const context = contextFor('1.2.3.4');

    for (let i = 0; i < 5; i++) {
      expect(guard.canActivate(context)).toBe(true);
    }
    let thrown: unknown;
    try {
      guard.canActivate(context);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApiException);
    expect(thrown).toMatchObject({ code: 'WAITLIST_RATE_LIMITED' });

    jest.advanceTimersByTime(60_001);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('slides rather than resetting on a fixed boundary', () => {
    const guard = new WaitlistRateLimitGuard();
    const context = contextFor('1.2.3.4');

    for (let i = 0; i < 5; i++) {
      guard.canActivate(context);
      jest.advanceTimersByTime(10_000); // hits at 0s, 10s, 20s, 30s, 40s
    }
    // 50s in: all five are still inside the window.
    expect(() => guard.canActivate(context)).toThrow(ApiException);
    // 61s in: the 0s hit has aged out, so exactly one slot opens. This also
    // pins that the blocked request at 50s was not itself counted — if it had
    // been, the window would still hold five and reject here.
    jest.advanceTimersByTime(11_000);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(ApiException);
  });

  it('counts each client separately', () => {
    const guard = new WaitlistRateLimitGuard();
    for (let i = 0; i < 5; i++) {
      guard.canActivate(contextFor('1.2.3.4'));
    }
    expect(guard.canActivate(contextFor('5.6.7.8'))).toBe(true);
  });
});
