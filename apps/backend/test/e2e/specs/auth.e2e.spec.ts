import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../../src/databases/kysely/database.types';
import { createFileDatabase } from '../harness/database';
import { createTestApp, type TestApp } from '../harness/create-test-app';
import { capturedEmails, clearCapturedEmails } from '../harness/resend-mock';
import {
  getSession,
  readOtp,
  signIn,
  signUp,
  verifyEmail,
} from '../harness/auth-client';

const PASSWORD = 'correct-horse-battery-staple';

async function emailVerifiedFor(
  db: Kysely<Database>,
  email: string,
): Promise<boolean | undefined> {
  const row = await db
    .selectFrom('auth.user')
    .select('emailVerified')
    .where('email', '=', email)
    .executeTakeFirst();
  return row?.emailVerified;
}

describe('auth: signup, otp, login', () => {
  let testApp: TestApp;
  let db: Kysely<Database>;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close: closeDb } = await createFileDatabase());
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
    await closeDb();
  });

  beforeEach(() => {
    clearCapturedEmails();
  });

  it('creates an unverified user and sends one OTP email on signup', async () => {
    const email = 'signup-happy@example.com';
    const res = await signUp(testApp.server, {
      email,
      password: PASSWORD,
      name: 'Signup Happy',
    });
    expect(res.status).toBe(200);
    expect(await emailVerifiedFor(db, email)).toBe(false);

    // emailOTP is configured with sendVerificationOnSignUp: true.
    expect(capturedEmails).toHaveLength(1);
    expect(capturedEmails[0].to).toBe(email);

    const otp = await readOtp(db, email);
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('refuses sign-in before the email is verified', async () => {
    const email = 'unverified@example.com';
    await signUp(testApp.server, {
      email,
      password: PASSWORD,
      name: 'Unverified',
    });

    // The `before` hook in auth.config.ts reads auth.user through the
    // application Kysely instance and throws APIError('FORBIDDEN'). This also
    // proves Better Auth's own pool and the app pool see the same database.
    const { res } = await signIn(testApp.server, { email, password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('verifies with the OTP and then signs in successfully', async () => {
    const email = 'verify-then-login@example.com';
    await signUp(testApp.server, {
      email,
      password: PASSWORD,
      name: 'Verify Then Login',
    });

    const otp = await readOtp(db, email);
    const verified = await verifyEmail(testApp.server, { email, otp });
    expect(verified.status).toBe(200);
    expect(await emailVerifiedFor(db, email)).toBe(true);

    const { res, cookie } = await signIn(testApp.server, {
      email,
      password: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(cookie).not.toBe('');

    const session = await getSession(testApp.server, cookie);
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe(email);
  });

  it('rejects a wrong password', async () => {
    const email = 'wrong-password@example.com';
    await signUp(testApp.server, {
      email,
      password: PASSWORD,
      name: 'Wrong Password',
    });
    const otp = await readOtp(db, email);
    await verifyEmail(testApp.server, { email, otp });

    const { res } = await signIn(testApp.server, {
      email,
      password: 'not-the-password',
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong OTP and does not verify the user', async () => {
    const email = 'wrong-otp@example.com';
    await signUp(testApp.server, {
      email,
      password: PASSWORD,
      name: 'Wrong Otp',
    });

    const res = await verifyEmail(testApp.server, { email, otp: '000000' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await emailVerifiedFor(db, email)).toBe(false);
  });
});

describe('POST /api/email-otp/send-verification', () => {
  let testApp: TestApp;
  let db: Kysely<Database>;
  let closeDb: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close: closeDb } = await createFileDatabase());
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
    await closeDb();
  });

  beforeEach(() => {
    clearCapturedEmails();
  });

  it('rejects a missing email with the ApiError envelope', async () => {
    const res = await request(testApp.server)
      .post('/api/email-otp/send-verification')
      .send({ type: 'sign-in' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'EMAIL_REQUIRED' });
  });

  it('rejects an unknown type and lists the allowed ones', async () => {
    const res = await request(testApp.server)
      .post('/api/email-otp/send-verification')
      .send({ email: 'someone@example.com', type: 'nonsense' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_TYPE_INVALID');
    expect(res.body.details.allowed).toEqual([
      'email-verification',
      'sign-in',
      'forget-password',
      'change-email',
    ]);
  });

  it('creates an OTP row and sends an email on the happy path', async () => {
    const email = 'otp-endpoint@example.com';
    await signUp(testApp.server, {
      email,
      password: PASSWORD,
      name: 'Otp Endpoint',
    });
    clearCapturedEmails();

    const res = await request(testApp.server)
      .post('/api/email-otp/send-verification')
      .send({ email, type: 'sign-in' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });

    const otp = await readOtp(db, email, 'sign-in');
    expect(otp).toMatch(/^\d{6}$/);
    expect(capturedEmails).toHaveLength(1);
  });
});
