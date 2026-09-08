import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  TestEmailRequest,
  UpdateLocalCredentialsRequest,
} from "@launchstack/api-interfaces";
import { LocalSettingsAPI } from "@/api/local-settings.api";
import { useActiveOrganizationStore } from "@/stores/active-organization-store";

// Machine-wide, not workspace-scoped: one secrets bundle per install, so no orgId in
// the status key. Usage is the exception — token spend is per workspace, so it
// keys on the active one like every other org-scoped query.
export const localSettingsKeys = {
  status: ["local-settings", "status"] as const,
  usage: (orgId: string | null) => ["local-settings", "usage", orgId] as const,
};

export function useLocalSettings() {
  return useQuery({
    queryKey: localSettingsKeys.status,
    queryFn: () => LocalSettingsAPI.status(),
  });
}

export function useLocalSettingsUsage() {
  const orgId = useActiveOrganizationStore((s) => s.activeOrganizationId);
  return useQuery({
    queryKey: localSettingsKeys.usage(orgId),
    queryFn: () => LocalSettingsAPI.usage(),
    enabled: !!orgId,
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
