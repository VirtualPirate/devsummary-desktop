import { buildPinoConfig } from './pino.config';

const getPinoOpts = (): any => {
  const cfg = buildPinoConfig();
  return cfg.pinoHttp;
};

const getRollTarget = (): any => {
  const opts = getPinoOpts();
  const targets = opts.transport.targets as any[];
  return targets.find((t) => t.target === 'pino-roll');
};

describe('buildPinoConfig', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_FILE_PATH;
    delete process.env.LOG_FILE_MAX_SIZE;
    delete process.env.LOG_FILE_KEEP_FILES;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses info level by default', () => {
    expect(getPinoOpts().level).toBe('info');
  });

  it('honors LOG_LEVEL when set', () => {
    process.env.LOG_LEVEL = 'debug';
    expect(getPinoOpts().level).toBe('debug');
  });

  it('writes via pino-roll to the default path when LOG_FILE_PATH is unset', () => {
    const target = getRollTarget();
    expect(target).toBeDefined();
    expect(target.options.file).toBe('../../logs/app.log');
    expect(target.options.mkdir).toBe(true);
  });

  it('honors LOG_FILE_PATH when set', () => {
    process.env.LOG_FILE_PATH = '/tmp/test.log';
    expect(getRollTarget().options.file).toBe('/tmp/test.log');
  });

  it('rotates at 50M and keeps 7 files by default', () => {
    const target = getRollTarget();
    expect(target.options.size).toBe('50M');
    expect(target.options.limit).toEqual({ count: 7 });
  });

  it('honors LOG_FILE_MAX_SIZE and LOG_FILE_KEEP_FILES overrides', () => {
    process.env.LOG_FILE_MAX_SIZE = '10M';
    process.env.LOG_FILE_KEEP_FILES = '3';
    const target = getRollTarget();
    expect(target.options.size).toBe('10M');
    expect(target.options.limit).toEqual({ count: 3 });
  });

  it('propagates the configured level to the transport target', () => {
    process.env.LOG_LEVEL = 'warn';
    expect(getRollTarget().level).toBe('warn');
  });

  describe('terminal output', () => {
    it('includes a pino-pretty target outside production', () => {
      process.env.NODE_ENV = 'development';
      const targets = getPinoOpts().transport.targets as any[];
      const pretty = targets.find((t) => t.target === 'pino-pretty');
      expect(pretty).toBeDefined();
      expect(pretty.options.colorize).toBe(true);
    });

    it('omits pino-pretty in production (file only)', () => {
      process.env.NODE_ENV = 'production';
      const targets = getPinoOpts().transport.targets as any[];
      expect(targets).toHaveLength(1);
      expect(targets[0].target).toBe('pino-roll');
    });
  });

  it('redacts authorization, cookie, and set-cookie headers', () => {
    const redact = getPinoOpts().redact;
    expect(redact.paths).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
      ]),
    );
    expect(redact.censor).toBe('[REDACTED]');
  });

  describe('genReqId', () => {
    const buildReq = (header?: string) => ({
      headers: header ? { 'x-request-id': header } : {},
    });
    const buildRes = () => ({ setHeader: jest.fn() });

    it('returns the inbound x-request-id verbatim when present', () => {
      const id = getPinoOpts().genReqId(buildReq('abc-123'), buildRes());
      expect(id).toBe('abc-123');
    });

    it('generates a non-empty id when no inbound header', () => {
      const id = getPinoOpts().genReqId(buildReq(), buildRes());
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it("does not write to res (response header is the middleware's job)", () => {
      const res = buildRes();
      getPinoOpts().genReqId(buildReq('abc-123'), res);
      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });
});
