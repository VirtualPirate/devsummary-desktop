import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentCliProviderName,
  RequestEmailVerificationRequest,
  UpdateLocalCredentialsRequest,
} from "@launchstack/api-interfaces";
import { LocalSettingsAPI } from "@/api/local-settings.api";

// Machine-wide, not workspace-scoped: one secrets bundle per install, so no orgId in
// the status key.
export const localSettingsKeys = {
  status: ["local-settings", "status"] as const,
  // Machine-wide like status: which CLIs are installed has nothing to do with
  // the active workspace.
  agents: ["local-settings", "agents"] as const,
  verification: ["local-settings", "verification"] as const,
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

export function useAgentClis() {
  return useQuery({
    queryKey: localSettingsKeys.agents,
    queryFn: () => LocalSettingsAPI.agents(),
    // Matches the detector's own 60 s cache: a refetch inside that window can
    // only get the same answer back, at the price of a request.
    staleTime: 60_000,
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: AgentCliProviderName) => LocalSettingsAPI.testAgentCli(id),
    // A test that passed is proof of a login the card may still be showing as
    // "Not logged in" from an older detect. The backend forces a re-detect to
    // run the test, so the refetch reads that fresh result rather than a
    // request the 60 s cache would answer with the stale one.
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: localSettingsKeys.agents,
      });
    },
  });
}

/**
 * Polls the magic-link gate while a link is outstanding.
 *
 * 4 s is the pacing the API is sized for: 15 checks a minute against a 60/min
 * per-IP budget, which leaves room for other installs behind the same NAT.
 * Polling stops on `verified` — the unlock is ours to keep — and on an expired
 * link, where the answer can no longer change without a new one. `linkExpired`
 * is the backend's own reading of its clock, refreshed by each poll.
 */
export function useEmailVerification() {
  return useQuery({
    queryKey: localSettingsKeys.verification,
    queryFn: () => LocalSettingsAPI.verification(),
    refetchInterval: (query) => {
      const state = query.state.data?.data;
      return state?.status === "pending" && !state.linkExpired ? 4_000 : false;
    },
  });
}

export function useRequestEmailVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: RequestEmailVerificationRequest) =>
      LocalSettingsAPI.requestVerification(payload),
    // The response is the state after one check, so there is nothing to refetch
    // — and writing it is what restarts the poll on the new `requestedAt`.
    onSuccess: (res) => {
      queryClient.setQueryData(localSettingsKeys.verification, res);
    },
  });
}
