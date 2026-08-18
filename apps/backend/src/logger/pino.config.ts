import type { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

const DEFAULT_LOG_FILE_PATH = '../../logs/app.log';
const DEFAULT_LOG_FILE_MAX_SIZE = '50M';
const DEFAULT_LOG_FILE_KEEP_FILES = 7;

/**
 * `../../logs/app.log` is relative to the repo root and only makes sense
 * headless. Inside the shell `DATA_DIR` is `app.getPath('userData')`, which is
 * where the database already lives and the one directory the app is guaranteed
 * to be able to write to — a packaged app's cwd is not.
 */
function logFilePath(): string {
  if (process.env.LOG_FILE_PATH) return process.env.LOG_FILE_PATH;
  const dataDir = process.env.DATA_DIR;
  return dataDir ? join(dataDir, 'logs', 'app.log') : DEFAULT_LOG_FILE_PATH;
}

const buildTargets = (level: string) => {
  const fileTarget = {
    target: 'pino-roll',
    level,
    options: {
      file: logFilePath(),
      size: process.env.LOG_FILE_MAX_SIZE ?? DEFAULT_LOG_FILE_MAX_SIZE,
      limit: {
        count: Number(
          process.env.LOG_FILE_KEEP_FILES ?? DEFAULT_LOG_FILE_KEEP_FILES,
        ),
      },
      mkdir: true,
    },
  };

  if (process.env.NODE_ENV === 'production') return [fileTarget];

  const prettyTarget = {
    target: 'pino-pretty',
    level,
    options: {
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname,req,res,responseTime',
      singleLine: true,
      // Console-only formatting. `messageFormat`/`ignore` live on the
      // pino-pretty target, so the JSON written to the file (and shipped to
      // Grafana by the OTel collector) is untouched. Request logs render as
      // "GET /path 200 (12ms)"; all other logs keep their own message.
      messageFormat:
        '{if req}{req.method} {req.url} {res.statusCode} ({responseTime}ms) {end}{msg}',
    },
  };

  return [prettyTarget, fileTarget];
};

export const buildPinoConfig = (): Params => {
  const level = process.env.LOG_LEVEL ?? 'info';
  return {
    pinoHttp: {
      level,
      genReqId: (req: IncomingMessage, _res: ServerResponse): string => {
        const existing = req.headers['x-request-id'];
        if (typeof existing === 'string' && existing.length > 0)
          return existing;
        return randomUUID();
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-desktop-token"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
      transport: {
        targets: buildTargets(level),
      },
    },
  };
};
