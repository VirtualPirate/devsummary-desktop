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
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { useActiveOrganizationStore } from "@/stores/active-organization-store";
import { AuthAPI } from "../../api/auth.api";

export const authSessionQueryKey = ["auth", "session"] as const;

/**
 * Wipes every trace of the user who just signed out from this tab: the cached
 * server state and the persisted active-organization id that the axios
 * interceptor stamps on every request as `X-Organization-Id`.
 *
 * Call this *after* navigating out of the protected shell. Doing it while the
 * org-scoped screens are still mounted makes their observers refetch straight
 * away — still carrying the previous user's org header — and lets
 * `useBootstrapActiveOrganization` re-install `orgs[0]` from the list that is
 * still sitting in the cache.
 */
export function clearSignedOutUserState(queryClient: QueryClient) {
  // Cache before store: if anything is somehow still mounted, an empty cache
  // makes `useMyOrganizations()` unresolved, so the bootstrap hook has no list
  // to fall back to when the active org disappears.
  queryClient.clear();
  useActiveOrganizationStore.getState().clear();
}

export function useAuthSession() {
  return useQuery<AuthClientResult<AuthSessionResponse>>({
    queryKey: authSessionQueryKey,
    queryFn: () => AuthAPI.getSession(),
    retry: false,
  });
}

export function useSignUpEmail() {
  const queryClient = useQueryClient();

  return useMutation<
    AuthClientResult<AuthEmailSignUpResponse>,
    Error,
    AuthEmailSignUpRequest
  >({
    mutationFn: (payload) => AuthAPI.signUpWithEmail(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
  });
}

export function useSignInEmail() {
  const queryClient = useQueryClient();

  return useMutation<
    AuthClientResult<AuthEmailSignInResponse>,
    Error,
    AuthEmailSignInRequest
  >({
    mutationFn: (payload) => AuthAPI.signInWithEmail(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
  });
}

export function useSignInGoogle() {
  const queryClient = useQueryClient();

  return useMutation<
    AuthClientResult<AuthSocialSignInResponse>,
    Error,
    AuthGoogleSignInRequest | undefined
  >({
    mutationFn: (payload) => AuthAPI.signInWithGoogle(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation<AuthClientResult<AuthSignOutResponse>, Error, void>({
    mutationFn: () => AuthAPI.signOut(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
  });
}

export function useSendVerificationOtp() {
  return useMutation<
    AuthSendVerificationOtpResponse,
    Error,
    AuthSendVerificationOtpRequest
  >({
    mutationFn: (payload) => AuthAPI.sendVerificationOtp(payload),
  });
}

export function useVerifyEmailOtp() {
  const queryClient = useQueryClient();

  return useMutation<
    AuthVerifyEmailOtpResponse,
    Error,
    AuthVerifyEmailOtpRequest
  >({
    mutationFn: (payload) => AuthAPI.verifyEmailOtp(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
  });
}

export function useForgetPassword() {
  return useMutation<
    AuthClientResult<AuthForgetPasswordResponse>,
    Error,
    AuthForgetPasswordRequest
  >({
    mutationFn: (payload) => AuthAPI.forgetPassword(payload),
  });
}

export function useResetPasswordWithOtp() {
  return useMutation<
    AuthClientResult<AuthResetPasswordResponse>,
    Error,
    AuthResetPasswordWithOtpRequest
  >({
    mutationFn: (payload) => AuthAPI.resetPasswordWithOtp(payload),
  });
}

export const authSessionsQueryKey = ["auth", "sessions"] as const;
export const authAccountsQueryKey = ["auth", "accounts"] as const;

/**
 * The Better Auth client resolves with `{ data, error }` instead of rejecting,
 * so a failed request would otherwise look like a successful empty one. The
 * settings screen renders a real error state for both of these, hence the
 * unwrap.
 */
function unwrap<T>(result: AuthClientResult<T>): T {
  if (result.error) {
    throw new Error(result.error.message || "Request failed");
  }
  return result.data as T;
}

/** Every device the user is signed in on, current one included. */
export function useAuthSessions() {
  return useQuery<AuthListSessionsResponse>({
    queryKey: authSessionsQueryKey,
    queryFn: async () => unwrap(await AuthAPI.listSessions()),
    retry: false,
  });
}

/** Ways the user can sign in — `credential`, `google`, … */
export function useAuthAccounts() {
  return useQuery<AuthListAccountsResponse>({
    queryKey: authAccountsQueryKey,
    queryFn: async () => unwrap(await AuthAPI.listAccounts()),
    retry: false,
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation<AuthUpdateUserResponse, Error, AuthUpdateUserRequest>({
    mutationFn: async (payload) => unwrap(await AuthAPI.updateUser(payload)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation<
    AuthChangePasswordResponse,
    Error,
    AuthChangePasswordRequest
  >({
    mutationFn: async (payload) =>
      unwrap(await AuthAPI.changePassword(payload)),
    onSuccess: async () => {
      // `revokeOtherSessions` ends every other session and reissues this one's
      // token, so both the session and the device list are stale.
      await queryClient.invalidateQueries({ queryKey: authSessionQueryKey });
      await queryClient.invalidateQueries({ queryKey: authSessionsQueryKey });
    },
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();

  return useMutation<AuthRevokeSessionResponse, Error, { token: string }>({
    mutationFn: async (payload) =>
      unwrap(await AuthAPI.revokeSession(payload)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authSessionsQueryKey });
    },
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();

  return useMutation<AuthRevokeSessionResponse, Error, void>({
    mutationFn: async () => unwrap(await AuthAPI.revokeOtherSessions()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authSessionsQueryKey });
    },
  });
}
