import { HttpStatus } from '@nestjs/common';
import { defineError, sealRegistry } from '../define-error';
import { ApiException } from '../api-errors';
import { AppError, type AppErrorCode } from '../application-errors';

describe('defineError + sealRegistry', () => {
  const Sealed = sealRegistry({
    SAMPLE_NO_ARGS: defineError({
      status: HttpStatus.BAD_REQUEST,
      message: 'static message',
    }),
    SAMPLE_DYNAMIC: defineError<{ reason: string }>({
      status: HttpStatus.BAD_GATEWAY,
      message: ({ reason }) => `failed: ${reason}`,
      details: ({ reason }) => ({ reason }),
    }),
    SAMPLE_DETAILS_ONLY: defineError<{ details: unknown }>({
      status: HttpStatus.BAD_REQUEST,
      message: 'validation failed',
      details: ({ details }) => ({ details }),
    }),
  });

  it('produces an ApiException whose code matches the registry key', () => {
    const exc = Sealed.SAMPLE_NO_ARGS();
    expect(exc).toBeInstanceOf(ApiException);
    expect(exc.code).toBe('SAMPLE_NO_ARGS');
    expect(exc.getStatus()).toBe(400);
    expect(exc.getResponse()).toEqual({
      code: 'SAMPLE_NO_ARGS',
      message: 'static message',
    });
  });

  it('interpolates dynamic message and details from args', () => {
    const exc = Sealed.SAMPLE_DYNAMIC({ reason: 'timeout' });
    expect(exc.code).toBe('SAMPLE_DYNAMIC');
    expect(exc.getStatus()).toBe(502);
    expect(exc.getResponse()).toEqual({
      code: 'SAMPLE_DYNAMIC',
      message: 'failed: timeout',
      details: { reason: 'timeout' },
    });
  });

  it('passes through details with a static message', () => {
    const exc = Sealed.SAMPLE_DETAILS_ONLY({ details: { field: 'email' } });
    expect(exc.code).toBe('SAMPLE_DETAILS_ONLY');
    expect(exc.getResponse()).toEqual({
      code: 'SAMPLE_DETAILS_ONLY',
      message: 'validation failed',
      details: { details: { field: 'email' } },
    });
  });
});

describe('AppError registry', () => {
  it('exposes a no-args factory for EMAIL_NOT_VERIFIED', () => {
    const exc = AppError.EMAIL_NOT_VERIFIED();
    expect(exc.code).toBe('EMAIL_NOT_VERIFIED');
    expect(exc.getStatus()).toBe(422);
    expect(exc.getResponse()).toEqual({
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Verify your email before handling invites',
    });
  });

  it('exposes a dynamic factory for OTP_CREATE_FAILED', () => {
    const exc = AppError.OTP_CREATE_FAILED({ reason: 'rate limited' });
    expect(exc.code).toBe('OTP_CREATE_FAILED');
    expect(exc.getStatus()).toBe(400);
    expect(exc.getResponse()).toEqual({
      code: 'OTP_CREATE_FAILED',
      message: 'rate limited',
      details: { reason: 'rate limited' },
    });
  });

  it('exposes a details-carrying factory for VALIDATION_ERROR', () => {
    const exc = AppError.VALIDATION_ERROR({ details: { field: 'email' } });
    expect(exc.code).toBe('VALIDATION_ERROR');
    expect(exc.getStatus()).toBe(400);
    expect((exc.getResponse() as { details: unknown }).details).toEqual({
      field: 'email',
    });
  });

  it('exposes a three-way ORG_TRANSFER split', () => {
    expect(AppError.ORG_TRANSFER_TO_SELF().code).toBe('ORG_TRANSFER_TO_SELF');
    expect(AppError.ORG_TRANSFER_TARGET_NOT_ADMIN().code).toBe(
      'ORG_TRANSFER_TARGET_NOT_ADMIN',
    );
    expect(AppError.ORG_TRANSFER_CALLER_NOT_OWNER().code).toBe(
      'ORG_TRANSFER_CALLER_NOT_OWNER',
    );
  });

  it('exposes a three-way MEMBER_FORBIDDEN split', () => {
    expect(AppError.MEMBER_REMOVE_OWNER_FORBIDDEN().code).toBe(
      'MEMBER_REMOVE_OWNER_FORBIDDEN',
    );
    expect(AppError.MEMBER_REMOVE_SELF_FORBIDDEN().code).toBe(
      'MEMBER_REMOVE_SELF_FORBIDDEN',
    );
    expect(AppError.MEMBER_INSUFFICIENT_ROLE().code).toBe(
      'MEMBER_INSUFFICIENT_ROLE',
    );
  });

  it('exports an AppErrorCode union containing all registry keys', () => {
    const codes: AppErrorCode[] = [
      'BAD_REQUEST',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'INTERNAL_SERVER_ERROR',
      'VALIDATION_ERROR',
      'EMAIL_NOT_VERIFIED',
      'EMAIL_REQUIRED',
      'OTP_TYPE_INVALID',
      'OTP_CREATE_FAILED',
      'OTP_EMAIL_SEND_FAILED',
      'ORG_HEADER_REQUIRED',
      'ORG_NOT_FOUND',
      'ORG_FORBIDDEN',
      'ORG_SLUG_CONFLICT',
      'ORG_TRANSFER_TO_SELF',
      'ORG_TRANSFER_TARGET_NOT_ADMIN',
      'ORG_TRANSFER_CALLER_NOT_OWNER',
      'MEMBER_NOT_FOUND',
      'MEMBER_IS_OWNER',
      'MEMBER_REMOVE_OWNER_FORBIDDEN',
      'MEMBER_REMOVE_SELF_FORBIDDEN',
      'MEMBER_INSUFFICIENT_ROLE',
      'OWNER_CANNOT_LEAVE',
      'INVITE_NOT_FOUND',
      'INVITE_NOT_PENDING',
      'INVITE_EXPIRED',
      'INVITE_TARGET_IS_MEMBER',
      'INVITE_EMAIL_MISMATCH',
      'INVITE_EMAIL_SEND_FAILED',
      'GITHUB_INSTALLATION_ALREADY_CONNECTED',
    ];
    for (const code of codes) {
      expect(typeof AppError[code]).toBe('function');
    }
    expect(codes).toHaveLength(31);
  });

  it('exposes a 409 for GITHUB_INSTALLATION_ALREADY_CONNECTED without naming the other org', () => {
    const exc = AppError.GITHUB_INSTALLATION_ALREADY_CONNECTED();
    expect(exc.code).toBe('GITHUB_INSTALLATION_ALREADY_CONNECTED');
    expect(exc.getStatus()).toBe(409);
    const body = exc.getResponse() as { message: string; details?: unknown };
    // The point of this test is the omission, not the wording: naming the other
    // organization would leak a tenant the caller has no access to.
    expect(body.message).toMatch(/already connected to another organization/i);
    expect(body.message).not.toMatch(
      /\borg(anization)?[-_ ]?(id|[0-9a-f]{8})\b/i,
    );
    expect(body.details).toBeUndefined();
    // Says the App is left installed, because the 409 path deliberately does not
    // uninstall it — GitHub allows one installation per account, so uninstalling
    // would break the org that legitimately owns it.
    expect(body.message).toMatch(/remains installed/i);
  });
});
