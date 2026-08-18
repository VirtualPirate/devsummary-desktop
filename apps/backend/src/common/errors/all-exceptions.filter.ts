import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AbstractHttpAdapter, BaseExceptionFilter } from '@nestjs/core';
import { ApiException } from './api-errors';

const STATUS_TO_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
};

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(httpAdapter: AbstractHttpAdapter) {
    super(httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return super.catch(exception, host);
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ url?: string; method?: string }>();
    const url = request?.url ?? '';

    if (url.startsWith('/api/auth/')) {
      return super.catch(exception, host);
    }

    if (exception instanceof ApiException) {
      return super.catch(exception, host);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_TO_CODE[status] ?? 'BAD_REQUEST';
      const message = exception.message;
      if (status >= 500) {
        this.logger.warn(
          `Raw HttpException ${status} on ${request?.method ?? '?'} ${url}: ${message}`,
        );
      }
      return super.catch(new ApiException(code, message, status), host);
    }

    const err = exception as Error;
    this.logger.error(
      `Unhandled exception on ${request?.method ?? '?'} ${url}: ${err?.message ?? exception}`,
      err?.stack,
    );
    return super.catch(
      new ApiException(
        'INTERNAL_SERVER_ERROR',
        'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      ),
      host,
    );
  }
}
