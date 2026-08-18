export interface AuthEmailSignUpRequest {
  name: string;
  email: string;
  password: string;
  image?: string;
  callbackURL?: string;
  rememberMe?: boolean;
}

export interface AuthEmailSignInRequest {
  email: string;
  password: string;
  callbackURL?: string;
  rememberMe?: boolean;
}

export interface AuthGoogleSignInRequest {
  callbackURL?: string;
  newUserCallbackURL?: string;
  errorCallbackURL?: string;
  disableRedirect?: boolean;
  requestSignUp?: boolean;
  loginHint?: string;
  additionalData?: Record<string, unknown>;
}

export type AuthOtpVerificationType = "email-verification" | "forget-password";

export interface AuthSendVerificationOtpRequest {
  email: string;
  type: AuthOtpVerificationType;
}

export interface AuthVerifyEmailOtpRequest {
  email: string;
  otp: string;
}

export interface AuthForgetPasswordRequest {
  email: string;
}

export interface AuthResetPasswordWithOtpRequest {
  email: string;
  otp: string;
  password: string;
}

export interface AuthUpdateUserRequest {
  name?: string;
  image?: string | null;
}

export interface AuthChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  /** Ends every other session; the current one gets a fresh token back. */
  revokeOtherSessions?: boolean;
}

export interface AuthRevokeSessionRequest {
  token: string;
}
