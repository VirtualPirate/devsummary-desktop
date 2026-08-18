import {
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ApiException } from '../api-errors';
import { AllExceptionsFilter } from '../all-exceptions.filter';

function makeHost(req: { url?: string; method?: string } = {}): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http' as const,
  } as unknown as ArgumentsHost;
}

function firstCatchArg<T>(spy: jest.SpyInstance): T {
  const row = spy.mock.calls[0] as [T, unknown] | undefined;
  if (!row) {
    throw new Error('expected BaseExceptionFilter.catch to be called');
  }
  return row[0];
}

describe('AllExceptionsFilter', () => {
  let superCatch: jest.SpyInstance;

  beforeEach(() => {
    superCatch = jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delegates to super for /api/auth/* paths regardless of exception type', () => {
    const filter = new AllExceptionsFilter({} as never);
    const exc = new Error('better-auth-internal');
    filter.catch(exc, makeHost({ url: '/api/auth/sign-in' }));
    expect(superCatch).toHaveBeenCalledTimes(1);
    expect(firstCatchArg<Error>(superCatch)).toBe(exc);
  });

  it('passes ApiException through unchanged', () => {
    const filter = new AllExceptionsFilter({} as never);
    const exc = new ApiException('FOO', 'foo msg', HttpStatus.BAD_REQUEST);
    filter.catch(exc, makeHost({ url: '/api/users' }));
    expect(superCatch).toHaveBeenCalledWith(exc, expect.anything());
  });

  it('wraps raw HttpException into ApiException with code derived from status', () => {
    const filter = new AllExceptionsFilter({} as never);
    const raw = new HttpException('cannot GET', HttpStatus.NOT_FOUND);
    filter.catch(raw, makeHost({ url: '/api/missing' }));
    const passed = firstCatchArg<ApiException>(superCatch);
    expect(passed).toBeInstanceOf(ApiException);
    expect(passed.code).toBe('NOT_FOUND');
    expect(passed.getStatus()).toBe(404);
    expect(passed.message).toBe('cannot GET');
  });

  it('falls back to BAD_REQUEST for raw HttpException with status outside the map', () => {
    const filter = new AllExceptionsFilter({} as never);
    const raw = new HttpException('teapot', 418);
    filter.catch(raw, makeHost({ url: '/x' }));
    const passed = firstCatchArg<ApiException>(superCatch);
    expect(passed.code).toBe('BAD_REQUEST');
    expect(passed.getStatus()).toBe(418);
    expect(passed.message).toBe('teapot');
  });

  it('replaces unhandled errors with INTERNAL_SERVER_ERROR and never leaks the original message', () => {
    const filter = new AllExceptionsFilter({} as never);
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const err = new Error('SECRET_VALUE_DO_NOT_LEAK');
    filter.catch(err, makeHost({ url: '/api/orgs', method: 'POST' }));
    const passed = firstCatchArg<ApiException>(superCatch);
    expect(passed.code).toBe('INTERNAL_SERVER_ERROR');
    expect(passed.message).toBe('Internal server error');
    expect(passed.getStatus()).toBe(500);
    const responseBody = JSON.stringify(passed.getResponse());
    expect(responseBody).not.toContain('SECRET_VALUE_DO_NOT_LEAK');
    expect(errorSpy).toHaveBeenCalled();
  });
});
