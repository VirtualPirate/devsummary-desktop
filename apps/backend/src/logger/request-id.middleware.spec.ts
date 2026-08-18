import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  const buildReq = (id?: string) => ({ id }) as any;
  const buildRes = (existingHeader?: string) => {
    const headers = new Map<string, string>();
    if (existingHeader) headers.set('x-request-id', existingHeader);
    return {
      getHeader: jest.fn((name: string) => headers.get(name.toLowerCase())),
      setHeader: jest.fn((name: string, value: string) => {
        headers.set(name.toLowerCase(), value);
      }),
    } as any;
  };

  it('writes x-request-id response header from req.id', () => {
    const req = buildReq('req-abc');
    const res = buildRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'req-abc');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite an existing response header', () => {
    const req = buildReq('req-abc');
    const res = buildRes('already-set');
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('skips header write when req.id is missing', () => {
    const req = buildReq(undefined);
    const res = buildRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
