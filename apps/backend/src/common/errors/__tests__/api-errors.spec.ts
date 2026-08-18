import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../api-errors';

describe('ApiException', () => {
  it('serializes as { code, message } when no details', () => {
    const exc = new ApiException(
      'SAMPLE',
      'Sample message',
      HttpStatus.BAD_REQUEST,
    );
    expect(exc.getResponse()).toEqual({
      code: 'SAMPLE',
      message: 'Sample message',
    });
    expect(exc.getStatus()).toBe(400);
  });

  it('serializes as { code, message, details } when details provided', () => {
    const exc = new ApiException(
      'WITH_DETAILS',
      'has details',
      HttpStatus.UNPROCESSABLE_ENTITY,
      { field: 'email' },
    );
    expect(exc.getResponse()).toEqual({
      code: 'WITH_DETAILS',
      message: 'has details',
      details: { field: 'email' },
    });
    expect(exc.getStatus()).toBe(422);
  });

  it('exposes code and details as readable properties', () => {
    const exc = new ApiException('CODE_X', 'msg', 400, { a: 1 });
    expect(exc.code).toBe('CODE_X');
    expect(exc.details).toEqual({ a: 1 });
  });

  it('defaults status to 400 when omitted', () => {
    const exc = new ApiException('DEFAULT_STATUS', 'msg');
    expect(exc.getStatus()).toBe(400);
  });
});
