export interface AuthUser {
  id?: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthSession {
  id?: string;
  expiresAt: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  userId: string;
}

export interface AuthSessionResponse {
  session: AuthSession;
  user: AuthUser;
}

export interface AuthEmailSignUpResponse {
  token?: string | null;
  user: AuthUser;
}

export interface AuthEmailSignInResponse {
  redirect?: boolean;
  token?: string;
  url?: string | null;
  user: AuthUser;
}

export interface AuthSocialSignInResponse {
  redirect?: boolean;
  token?: string;
  url?: string | null;
  user?: AuthUser;
}

export interface AuthSignOutResponse {
  success?: boolean;
}

export interface AuthSendVerificationOtpResponse {
  success?: boolean;
}

export interface AuthVerifyEmailOtpResponse {
  status: true;
  token: string | null;
  user: AuthUser;
}

export interface AuthErrorResponse {
  message: string;
}

export interface AuthClientResult<TData, TError = AuthErrorResponse> {
  data: TData | null;
  error: TError | null;
}

export interface AuthForgetPasswordResponse {
  success?: boolean;
}

export interface AuthResetPasswordResponse {
  success?: boolean;
}

export interface AuthUpdateUserResponse {
  status: boolean;
}

export interface AuthChangePasswordResponse {
  /** Present only when `revokeOtherSessions` was set. */
  token?: string | null;
  user?: AuthUser;
}

export type AuthListSessionsResponse = AuthSession[];

export interface AuthRevokeSessionResponse {
  status: boolean;
}

/** One row per way the user can sign in: `credential`, `google`, … */
export interface AuthAccount {
  id: string;
  providerId: string;
  accountId?: string;
  createdAt?: string;
  updatedAt?: string;
  scopes?: string[];
}

export type AuthListAccountsResponse = AuthAccount[];
