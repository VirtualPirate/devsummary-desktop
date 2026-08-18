import type { Server } from 'node:http';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../../../src/databases/kysely/database.types';

/**
 * Better Auth builds the OTP verification identifier as
 * `${type}-otp-${email}` (toOTPIdentifier in
 * better-auth/dist/plugins/email-otp/utils.mjs). The stored `value` is the
 * plain OTP, optionally suffixed with `:<attempts>` — the default `storeOTP`
 * mode is plain, so no decryption is needed. Emails must be lowercase for the
 * identifier to match.
 */
export async function readOtp(
  db: Kysely<Database>,
  email: string,
  type = 'email-verification',
): Promise<string> {
  const identifier = `${type}-otp-${email}`;
  const row = await db
    .selectFrom('auth.verification')
    .select('value')
    .where('identifier', '=', identifier)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst();

  if (!row) {
    throw new Error(`No OTP row found for identifier "${identifier}"`);
  }
  return row.value.split(':')[0];
}

export function signUp(
  server: Server,
  user: { email: string; password: string; name: string },
) {
  return request(server).post('/api/auth/sign-up/email').send(user);
}

export function verifyEmail(
  server: Server,
  payload: { email: string; otp: string },
) {
  return request(server).post('/api/auth/email-otp/verify-email').send(payload);
}

export async function signIn(
  server: Server,
  credentials: { email: string; password: string },
): Promise<{ res: request.Response; cookie: string }> {
  const res = await request(server)
    .post('/api/auth/sign-in/email')
    .send(credentials);
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return { res, cookie: (raw ?? []).join('; ') };
}

export function getSession(server: Server, cookie: string) {
  return request(server).get('/api/auth/get-session').set('Cookie', cookie);
}

/** Full happy path: sign up, read the OTP from Postgres, verify, sign in. */
export async function createVerifiedUser(
  server: Server,
  db: Kysely<Database>,
  user: { email: string; password: string; name: string },
): Promise<{ cookie: string; userId: string }> {
  await signUp(server, user);
  const otp = await readOtp(db, user.email);
  await verifyEmail(server, { email: user.email, otp });
  const { cookie } = await signIn(server, {
    email: user.email,
    password: user.password,
  });
  const session = await getSession(server, cookie);
  const userId = session.body?.user?.id as string | undefined;
  if (!userId) {
    throw new Error(
      `Could not read a user id from the session for ${user.email}. ` +
        `Body was: ${JSON.stringify(session.body)}`,
    );
  }
  return { cookie, userId };
}
