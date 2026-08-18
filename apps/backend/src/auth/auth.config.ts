import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP, openAPI } from 'better-auth/plugins';
import { Pool } from 'pg';
import { Resend } from 'resend';
import type { AppDatabase } from '../databases/kysely';
import { renderOtpEmail } from '../emails/render-email';
import { deriveKey, encrypt } from './crypto';

export interface AuthConfig {
  db: AppDatabase;
  databaseUrl: string;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  resendApiKey: string;
  emailFrom: string;
  nodeEnv?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}

export function createAuth(config: AuthConfig) {
  const resend = new Resend(config.resendApiKey);
  const googleEnabled = config.googleClientId && config.googleClientSecret;
  const encryptionKey = deriveKey(config.secret);

  return betterAuth({
    // Better Auth runs its own Kysely instance over this pool. The auth tables
    // live in the `auth` Postgres schema with snake_case columns, hence the
    // search_path and the per-model `fields` mappings below.
    database: new Pool({
      connectionString: config.databaseUrl,
      options: '-c search_path=auth',
    }),
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
    user: {
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      fields: {
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        userId: 'user_id',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      ...(googleEnabled && {
        accountLinking: {
          enabled: true,
          trustedProviders: ['google'],
        },
      }),
    },
    ...(googleEnabled && {
      socialProviders: {
        google: {
          clientId: config.googleClientId!,
          clientSecret: config.googleClientSecret!,
        },
      },
    }),
    emailAndPassword: { enabled: true },
    advanced: {
      disableCSRFCheck: config.nodeEnv !== 'production',
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') {
          return;
        }

        const email =
          typeof ctx.body === 'object' &&
          ctx.body !== null &&
          'email' in ctx.body &&
          typeof (ctx.body as { email?: unknown }).email === 'string'
            ? (ctx.body as { email: string }).email
            : undefined;

        if (!email) {
          return;
        }

        const existingUser = await config.db
          .selectFrom('auth.user')
          .select('emailVerified')
          .where('email', '=', email)
          .executeTakeFirst();

        if (existingUser && !existingUser.emailVerified) {
          throw new APIError('FORBIDDEN', {
            message:
              'Please verify your email with the OTP code before signing in.',
          });
        }
      }),
    },
    databaseHooks: {
      account: {
        create: {
          before: (account) => {
            const encrypted = { ...account };
            if (account.accessToken) {
              encrypted.accessToken = encrypt(
                account.accessToken,
                encryptionKey,
              );
            }
            if (account.refreshToken) {
              encrypted.refreshToken = encrypt(
                account.refreshToken,
                encryptionKey,
              );
            }
            return Promise.resolve({ data: encrypted });
          },
        },
        update: {
          before: (account) => {
            const encrypted = { ...account };
            if (account.accessToken) {
              encrypted.accessToken = encrypt(
                account.accessToken,
                encryptionKey,
              );
            }
            if (account.refreshToken) {
              encrypted.refreshToken = encrypt(
                account.refreshToken,
                encryptionKey,
              );
            }
            return Promise.resolve({ data: encrypted });
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        sendVerificationOnSignUp: true,
        async sendVerificationOTP({ email, otp, type }) {
          const { subject, html, text } = await renderOtpEmail(otp, type);
          const { data, error } = await resend.emails.send({
            from: config.emailFrom,
            to: email,
            subject,
            html,
            text,
          });
          if (error) {
            console.error('Resend email failed (background):', error);
            return;
          }
          console.log('OTP email sent:', data?.id);
        },
      }),
      ...(config.nodeEnv !== 'production' ? [openAPI()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
