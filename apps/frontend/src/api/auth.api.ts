import {
  type AuthChangePasswordRequest,
  type AuthChangePasswordResponse,
  type AuthClientResult,
  type AuthEmailSignInRequest,
  type AuthEmailSignInResponse,
  type AuthEmailSignUpRequest,
  type AuthEmailSignUpResponse,
  type AuthForgetPasswordRequest,
  type AuthForgetPasswordResponse,
  type AuthGoogleSignInRequest,
  type AuthListAccountsResponse,
  type AuthListSessionsResponse,
  type AuthResetPasswordResponse,
  type AuthResetPasswordWithOtpRequest,
  type AuthRevokeSessionRequest,
  type AuthRevokeSessionResponse,
  type AuthSendVerificationOtpRequest,
  type AuthSendVerificationOtpResponse,
  type AuthSessionResponse,
  type AuthSignOutResponse,
  type AuthSocialSignInResponse,
  type AuthUpdateUserRequest,
  type AuthUpdateUserResponse,
  type AuthVerifyEmailOtpRequest,
  type AuthVerifyEmailOtpResponse,
} from "@launchstack/api-interfaces";

import { axiosInstance } from "@/api/axios-client";
import { authClient } from "@/lib/auth-client";

export const AuthAPI = {
  signUpWithEmail: async (
    payload: AuthEmailSignUpRequest,
  ): Promise<AuthClientResult<AuthEmailSignUpResponse>> => {
    const response = await authClient.signUp.email(payload);
    return response as AuthClientResult<AuthEmailSignUpResponse>;
  },

  signInWithEmail: async (
    payload: AuthEmailSignInRequest,
  ): Promise<AuthClientResult<AuthEmailSignInResponse>> => {
    const response = await authClient.signIn.email(payload);
    return response as AuthClientResult<AuthEmailSignInResponse>;
  },

  signInWithGoogle: async (
    payload: AuthGoogleSignInRequest = {},
  ): Promise<AuthClientResult<AuthSocialSignInResponse>> => {
    const response = await authClient.signIn.social({
      provider: "google",
      ...payload,
    });
    return response as AuthClientResult<AuthSocialSignInResponse>;
  },

  getSession: async (): Promise<AuthClientResult<AuthSessionResponse>> => {
    const response = await authClient.getSession();
    return response as AuthClientResult<AuthSessionResponse>;
  },

  signOut: async (): Promise<AuthClientResult<AuthSignOutResponse>> => {
    const response = await authClient.signOut();
    return response as AuthClientResult<AuthSignOutResponse>;
  },

  sendVerificationOtp: async (
    payload: AuthSendVerificationOtpRequest,
  ): Promise<AuthSendVerificationOtpResponse> => {
    const response = await axiosInstance.request({
      url: "/api/email-otp/send-verification",
      method: "POST",
      data: payload,
    });

    return response.data as AuthSendVerificationOtpResponse;
  },

  verifyEmailOtp: async (
    payload: AuthVerifyEmailOtpRequest,
  ): Promise<AuthVerifyEmailOtpResponse> => {
    const response = await axiosInstance.request({
      url: "/api/auth/email-otp/verify-email",
      method: "POST",
      data: payload,
    });

    return response.data as AuthVerifyEmailOtpResponse;
  },

  forgetPassword: async (
    payload: AuthForgetPasswordRequest,
  ): Promise<AuthClientResult<AuthForgetPasswordResponse>> => {
    const response = await authClient.forgetPassword.emailOtp(payload);
    return response as AuthClientResult<AuthForgetPasswordResponse>;
  },

  resetPasswordWithOtp: async (
    payload: AuthResetPasswordWithOtpRequest,
  ): Promise<AuthClientResult<AuthResetPasswordResponse>> => {
    const response = await authClient.emailOtp.resetPassword(payload);
    return response as AuthClientResult<AuthResetPasswordResponse>;
  },

  updateUser: async (
    payload: AuthUpdateUserRequest,
  ): Promise<AuthClientResult<AuthUpdateUserResponse>> => {
    const response = await authClient.updateUser(payload);
    return response as AuthClientResult<AuthUpdateUserResponse>;
  },

  changePassword: async (
    payload: AuthChangePasswordRequest,
  ): Promise<AuthClientResult<AuthChangePasswordResponse>> => {
    const response = await authClient.changePassword(payload);
    return response as AuthClientResult<AuthChangePasswordResponse>;
  },

  listSessions: async (): Promise<
    AuthClientResult<AuthListSessionsResponse>
  > => {
    const response = await authClient.listSessions();
    return response as AuthClientResult<AuthListSessionsResponse>;
  },

  revokeSession: async (
    payload: AuthRevokeSessionRequest,
  ): Promise<AuthClientResult<AuthRevokeSessionResponse>> => {
    const response = await authClient.revokeSession(payload);
    return response as AuthClientResult<AuthRevokeSessionResponse>;
  },

  revokeOtherSessions: async (): Promise<
    AuthClientResult<AuthRevokeSessionResponse>
  > => {
    const response = await authClient.revokeOtherSessions();
    return response as AuthClientResult<AuthRevokeSessionResponse>;
  },

  listAccounts: async (): Promise<
    AuthClientResult<AuthListAccountsResponse>
  > => {
    const response = await authClient.listAccounts();
    return response as AuthClientResult<AuthListAccountsResponse>;
  },
};
