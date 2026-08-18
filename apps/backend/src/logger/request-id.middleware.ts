import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req as Request & { id?: string }).id;
    if (requestId && !res.getHeader('x-request-id')) {
      res.setHeader('x-request-id', requestId);
    }
    next();
  }
}
