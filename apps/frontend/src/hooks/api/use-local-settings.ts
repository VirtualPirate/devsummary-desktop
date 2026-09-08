import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentCliProviderName,
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
  // Machine-wide like status: which CLIs are installed has nothing to do with
  // the active workspace.
  agents: ["local-settings", "agents"] as const,
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

export function useAgentClis() {
  return useQuery({
    queryKey: localSettingsKeys.agents,
    queryFn: () => LocalSettingsAPI.agents(),
    // A detect can spawn a login shell; three retries would triple that for a
    // failure the page shows rather than hides.
    retry: false,
  });
}

/**
 * A mutation, not `refetch()`: forcing a re-detect means asking the backend to
 * bypass its own 60 s cache, which is a different request than the cached one
 * the query key stands for.
 */
export function useRefreshAgentClis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => LocalSettingsAPI.agents(true),
    onSuccess: (res) => {
      queryClient.setQueryData(localSettingsKeys.agents, res);
    },
  });
}

export function useTestAgentCli() {
  return useMutation({
    mutationFn: (id: AgentCliProviderName) => LocalSettingsAPI.testAgentCli(id),
  });
}
