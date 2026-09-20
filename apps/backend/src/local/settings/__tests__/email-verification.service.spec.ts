import {
  EMAIL_VERIFICATION_KEY,
  EmailVerificationService,
} from '../email-verification.service';

/** A `local_settings` stand-in: one key, whatever the service last wrote. */
function makeSettings(initial: unknown = null) {
  const store: Record<string, unknown> = { [EMAIL_VERIFICATION_KEY]: initial };
  return {
    get: jest.fn(async (key: string, fallback: unknown) =>
      store[key] === null || store[key] === undefined ? fallback : store[key],
    ),
    set: jest.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
    read: () => store[EMAIL_VERIFICATION_KEY],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const ok = (verified: boolean) =>
  jsonResponse(200, {
    data: { email: 'dev@example.com', verified },
    message: 'OK',
    success: true,
  });

describe('EmailVerificationService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock;
  });

  it('reports unverified, and asks nothing, with no stored state', async () => {
    const svc = new EmailVerificationService(makeSettings() as never);

    expect(await svc.check()).toEqual({
      status: 'unverified',
      email: null,
      requestedAt: null,
      verifiedAt: null,
      linkExpired: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes the address before sending and storing it', async () => {
    const settings = makeSettings();
    const svc = new EmailVerificationService(settings as never);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { data: null, success: true }))
      .mockResolvedValueOnce(ok(false));

    const out = await svc.request('  Dev@Example.COM ');

    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify({ email: 'dev@example.com' }),
    );
    expect(settings.read()).toMatchObject({
      status: 'pending',
      email: 'dev@example.com',
    });
    expect(out.status).toBe('pending');
  });

  it('rejects a malformed address without calling the API', async () => {
    const svc = new EmailVerificationService(makeSettings() as never);

    await expect(svc.request('not-an-email')).rejects.toMatchObject({
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports verified when the immediate check comes back verified', async () => {
    const settings = makeSettings();
    const svc = new EmailVerificationService(settings as never);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { data: null, success: true }))
      .mockResolvedValueOnce(ok(true));

    const out = await svc.request('dev@example.com');

    expect(out.status).toBe('verified');
    expect(settings.read()).toMatchObject({ status: 'verified' });
  });

  it('never reports verified on a 201 alone', async () => {
    const settings = makeSettings();
    const svc = new EmailVerificationService(settings as never);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { data: null, success: true }))
      .mockResolvedValueOnce(ok(false));

    await svc.request('dev@example.com');

    expect(settings.read()).toMatchObject({ status: 'pending' });
  });

  it('surfaces a rate limit with its retry window', async () => {
    const svc = new EmailVerificationService(makeSettings() as never);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, {
        code: 'RATE_LIMITED',
        message: 'Too many requests; try again in 12s',
        details: { retryAfterSeconds: 12 },
      }),
    );

    await expect(svc.request('dev@example.com')).rejects.toMatchObject({
      code: 'EMAIL_VERIFICATION_RATE_LIMITED',
      details: { retryAfterSeconds: 12 },
    });
  });

  it('answers a verified install from disk, without asking the API', async () => {
    const settings = makeSettings({
      status: 'verified',
      email: 'dev@example.com',
      verifiedAt: '2026-09-01T00:00:00.000Z',
    });
    const svc = new EmailVerificationService(settings as never);

    const out = await svc.check();

    expect(out).toEqual({
      status: 'verified',
      email: 'dev@example.com',
      requestedAt: null,
      verifiedAt: '2026-09-01T00:00:00.000Z',
      linkExpired: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays pending — never throws, never clears — when the API is unreachable', async () => {
    const settings = makeSettings({
      status: 'pending',
      email: 'dev@example.com',
      requestedAt: '2026-09-01T00:00:00.000Z',
    });
    const svc = new EmailVerificationService(settings as never);
    fetchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));

    const out = await svc.check();

    expect(out.status).toBe('pending');
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('marks a link older than its 24-hour life expired', async () => {
    const svc = new EmailVerificationService(
      makeSettings({
        status: 'pending',
        email: 'dev@example.com',
        requestedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      }) as never,
    );
    fetchMock.mockResolvedValueOnce(ok(false));

    const out = await svc.check();

    expect(out).toMatchObject({ status: 'pending', linkExpired: true });
  });

  it('persists the verified status the first time a poll sees it', async () => {
    const settings = makeSettings({
      status: 'pending',
      email: 'dev@example.com',
      requestedAt: '2026-09-01T00:00:00.000Z',
    });
    const svc = new EmailVerificationService(settings as never);
    fetchMock.mockResolvedValueOnce(ok(true));

    expect((await svc.check()).status).toBe('verified');
    expect(settings.read()).toMatchObject({ status: 'verified' });

    // A second poll is answered locally — one confirmation, one request.
    expect((await svc.check()).status).toBe('verified');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
