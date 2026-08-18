import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  TestEmailRequest,
  UpdateLocalCredentialsRequest,
} from "@launchstack/api-interfaces";
import { LocalSettingsAPI } from "@/api/local-settings.api";

// Machine-wide, not workspace-scoped: one keychain per install, so no orgId in
// the key.
export const localSettingsKeys = {
  status: ["local-settings", "status"] as const,
};

export function useLocalSettings() {
  return useQuery({
    queryKey: localSettingsKeys.status,
    queryFn: () => LocalSettingsAPI.status(),
  });
}

export function useUpdateLocalCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateLocalCredentialsRequest) =>
      LocalSettingsAPI.updateCredentials(payload),
    onSuccess: (res) => {
      // The response is the new status, so there is nothing to refetch.
      queryClient.setQueryData(localSettingsKeys.status, res);
    },
  });
}

export function useSendTestEmail() {
  return useMutation({
    mutationFn: (payload: TestEmailRequest) =>
      LocalSettingsAPI.testEmail(payload),
  });
}
