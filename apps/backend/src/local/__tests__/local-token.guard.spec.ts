import type { ExecutionContext } from '@nestjs/common';
import { LocalTokenGuard } from '../local-token.guard';
import { LocalSessionMiddleware } from '../local-session.middleware';
import {
  LOCAL_USER_EMAIL,
  LOCAL_USER_ID,
  LOCAL_USER_NAME,
} from '../local-identity';

const TOKEN = 'a'.repeat(64);

function ctxFor(url: string, token?: string): ExecutionContext {
  const request = {
    url,
    headers: token === undefined ? {} : { 'x-desktop-token': token },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('LocalTokenGuard', () => {
  const original = process.env.API_TOKEN;
  afterEach(() => {
    process.env.API_TOKEN = original;
  });

  function guardWith(token: string | undefined): LocalTokenGuard {
    if (token === undefined) {
      delete process.env.API_TOKEN;
    } else {
      process.env.API_TOKEN = token;
    }
    // The token is read at construction, so build after setting the env.
    return new LocalTokenGuard();
  }

  it('allows a request carrying the exact token', () => {
    expect(
      guardWith(TOKEN).canActivate(ctxFor('/api/organizations/current', TOKEN)),
    ).toBe(true);
  });

  it('401s when the header is absent', () => {
    expect(() =>
      guardWith(TOKEN).canActivate(ctxFor('/api/organizations/current')),
    ).toThrow(expect.objectContaining({ status: 401 }));
  });

  it.each([
    ['a wrong token of equal length', 'b'.repeat(64)],
    ['a prefix of the real token', 'a'.repeat(63)],
    ['the real token plus a suffix', `${TOKEN}x`],
    ['an empty string', ''],
  ])('401s on %s', (_label, given) => {
    expect(() =>
      guardWith(TOKEN).canActivate(ctxFor('/api/organizations/current', given)),
    ).toThrow(expect.objectContaining({ status: 401 }));
  });

  // timingSafeEqual throws a RangeError on mismatched buffer lengths, so the
  // length check has to come first — a crash here would be a 500, not a 401,
  // and a 500 on a wrong-length token is itself an oracle.
  it('never lets timingSafeEqual see mismatched lengths', () => {
    const guard = guardWith(TOKEN);
    for (const given of ['', 'x', TOKEN.slice(0, 10), `${TOKEN}${TOKEN}`]) {
      expect(() => guard.canActivate(ctxFor('/api/x', given))).toThrow(
        expect.objectContaining({ status: 401 }),
      );
    }
  });

  // Fail-closed: an unconfigured backend must be unreachable, not open.
  it('401s on every non-health route when API_TOKEN is unset', () => {
    const guard = guardWith(undefined);
    expect(() =>
      guard.canActivate(ctxFor('/api/organizations/current')),
    ).toThrow(expect.objectContaining({ status: 401 }));
    expect(() =>
      guard.canActivate(ctxFor('/api/organizations/current', '')),
    ).toThrow(expect.objectContaining({ status: 401 }));
  });

  // Electron's main process polls these to decide the backend came up, and it
  // does so before it has any reason to trust the child with the token.
  it.each(['/api/health', '/api/health/live', '/api/health?verbose=1'])(
    'lets %s through without a token',
    (url) => {
      expect(guardWith(TOKEN).canActivate(ctxFor(url))).toBe(true);
    },
  );

  it('does not treat a health-prefixed path as health', () => {
    expect(() =>
      guardWith(TOKEN).canActivate(ctxFor('/api/healthzzz/secret')),
    ).toThrow(expect.objectContaining({ status: 401 }));
  });
});

describe('LocalSessionMiddleware', () => {
  it('populates request.session with the seeded local user', () => {
    const req: { session?: unknown } = {};
    const next = jest.fn();
    new LocalSessionMiddleware().use(req, null, next);

    expect(req.session).toEqual({
      user: {
        id: LOCAL_USER_ID,
        email: LOCAL_USER_EMAIL,
        name: LOCAL_USER_NAME,
        emailVerified: true,
      },
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
